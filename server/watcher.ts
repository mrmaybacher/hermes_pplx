// The watcher: every 10 minutes, fetch new emails, extract intent, persist.
import { storage } from "./storage";
import { fetchNewEmails, usingRealGraph, primeMockFull } from "./emailSource";
import type { RawEmail } from "./emailSource";
import { extractFromEmail } from "./extract";

const WATCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const HERMES_ADDRESS = (process.env.GRAPH_MAILBOX || "hermes@angelsestate.bg").toLowerCase();
const OWNER_ADDRESS = "g.meriacre@angelsestate.bg"; // the business owner ("You")
let running = false;
let lastRunAt: string | null = null;

// Turn an email local-part into a display name, e.g.
// "petar.georgiev@angelsestate.bg" → "Petar Georgiev".
function displayNameFromEmail(addr: string): string {
  const local = addr.split("@")[0] || addr;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || addr;
}

// Infer the assignee from the recipients when GPT left it blank. Hermes and the
// owner are excluded from being picked when other recipients exist; preference
// is the first non-Hermes/non-owner To, then CC, else the owner ("You").
function inferAssignee(raw: RawEmail): { name: string | null; email: string | null } {
  const excluded = new Set([HERMES_ADDRESS, OWNER_ADDRESS]);
  const pick = (list: string[]) =>
    list.map((e) => e.trim()).filter((e) => e && !excluded.has(e.toLowerCase()))[0];
  const chosen = pick(raw.toRecipients) || pick(raw.ccRecipients);
  if (chosen) return { name: displayNameFromEmail(chosen), email: chosen.toLowerCase() };
  return { name: null, email: null }; // falls back to owner ("You") in the UI
}

// The recipient gate: Hermes only acts on an email when it was intentionally
// involved — i.e. hermes@ is in the To or CC field. This covers all four
// trigger cases (CC'd, forwarded to, written to directly, or kept on a
// reply-all thread). Everything else is stored for audit but never becomes a
// task/contract/reply.
function hermesIsRecipient(raw: RawEmail): boolean {
  return [...raw.toRecipients, ...raw.ccRecipients]
    .map((e) => e.toLowerCase())
    .includes(HERMES_ADDRESS);
}

// Lookback window. Hermes ingests mail received within the last
// LOOKBACK_DAYS (counting from the start of that day). Override with the
// HERMES_LOOKBACK_DAYS env var; defaults to 3 days.
const LOOKBACK_DAYS = Number(process.env.HERMES_LOOKBACK_DAYS ?? 3);
function lookbackSinceIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, LOOKBACK_DAYS - 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function processEmail(raw: RawEmail): Promise<void> {
  // Dedup: skip if we've already ingested this message id.
  const seen = await storage.getEmailByMessageId(raw.messageId);
  if (seen) return;

  // ── Recipient gate ──────────────────────────────────
  // If Hermes was not intentionally involved (not in To/CC), store the email
  // for audit as "other" and stop — no extraction, no task/contract/reply.
  if (!hermesIsRecipient(raw)) {
    const email = await storage.createEmail({
      messageId: raw.messageId,
      conversationId: raw.conversationId,
      fromName: raw.fromName,
      fromEmail: raw.fromEmail,
      toRecipients: JSON.stringify(raw.toRecipients),
      ccRecipients: JSON.stringify(raw.ccRecipients),
      subject: raw.subject,
      bodyPreview: raw.bodyPreview,
      body: raw.body,
      receivedAt: raw.receivedAt,
      classification: "other",
      processed: true,
      ingestedAt: new Date().toISOString(),
    });
    await storage.logActivity({
      type: "email_ignored",
      message: `Email ignored — Hermes not a recipient: "${raw.subject}"`,
      entityType: "email",
      entityId: email.id,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const extraction = await extractFromEmail(raw);

  const email = await storage.createEmail({
    messageId: raw.messageId,
    conversationId: raw.conversationId,
    fromName: raw.fromName,
    fromEmail: raw.fromEmail,
    toRecipients: JSON.stringify(raw.toRecipients),
    ccRecipients: JSON.stringify(raw.ccRecipients),
    subject: raw.subject,
    bodyPreview: raw.bodyPreview,
    body: raw.body,
    receivedAt: raw.receivedAt,
    classification: extraction.classification,
    processed: true,
    ingestedAt: new Date().toISOString(),
  });

  await storage.logActivity({
    type: "email_ingested",
    message: `New email from ${raw.fromName}: "${raw.subject}"`,
    entityType: "email",
    entityId: email.id,
    createdAt: new Date().toISOString(),
  });

  if (extraction.classification === "reply") {
    // Link to existing task/contract by conversation id.
    await storage.createThreadMessage({
      conversationId: raw.conversationId,
      emailId: email.id,
      fromName: raw.fromName,
      fromEmail: raw.fromEmail,
      snippet: extraction.replySummary || raw.bodyPreview.slice(0, 160),
      receivedAt: raw.receivedAt,
    });
    const linkedTask = await storage.findTaskByConversation(raw.conversationId);
    const linkedContract = linkedTask ? undefined : await storage.findContractByConversation(raw.conversationId);
    const target = linkedTask
      ? `task "${linkedTask.title}"`
      : linkedContract
      ? `contract "${linkedContract.title}"`
      : "an untracked thread";
    await storage.logActivity({
      type: "reply_linked",
      message: `Reply from ${raw.fromName} linked to ${target}`,
      entityType: linkedTask ? "task" : linkedContract ? "contract" : "email",
      entityId: linkedTask?.id ?? linkedContract?.id ?? email.id,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  // Both "task" and "contract" classifications now feed the SAME task path.
  // Contracts are no longer a separate concept: a contract-like email becomes a
  // normal task whose title is the document subject, at normal priority.
  const isTaskLike =
    (extraction.classification === "task" && extraction.task) ||
    (extraction.classification === "contract" && extraction.contract);

  if (isTaskLike) {
    // Normalise both shapes into a single task draft.
    const draft = extraction.task
      ? {
          title: extraction.task.title,
          description: extraction.task.description,
          assigneeName: extraction.task.assigneeName,
          assigneeEmail: extraction.task.assigneeEmail,
          dueDate: extraction.task.dueDate,
          priority: extraction.task.priority,
        }
      : {
          title: extraction.contract!.title,
          description: raw.body || raw.bodyPreview || "",
          assigneeName: null as string | null,
          assigneeEmail: null as string | null,
          dueDate: null as string | null,
          priority: "medium" as const,
        };

    // 1B — infer the assignee from To/CC when GPT left it blank.
    if (!draft.assigneeName && !draft.assigneeEmail) {
      const inferred = inferAssignee(raw);
      draft.assigneeName = inferred.name;
      draft.assigneeEmail = inferred.email;
    }

    // Register the assignee. If we have a name but no email, synthesize a stable
    // key so the same person groups together on the People board.
    if (draft.assigneeName || draft.assigneeEmail) {
      const personEmail = draft.assigneeEmail
        || `${draft.assigneeName!.toLowerCase().replace(/\s+/g, ".")}@team`;
      await storage.upsertPerson({
        name: draft.assigneeName || draft.assigneeEmail!,
        email: personEmail,
        createdAt: new Date().toISOString(),
      });
      draft.assigneeEmail = personEmail;
    }

    const task = await storage.createTask({
      title: draft.title,
      description: draft.description,
      assigneeName: draft.assigneeName,
      assigneeEmail: draft.assigneeEmail,
      dueDate: draft.dueDate,
      priority: draft.priority,
      status: "open",
      sourceEmailId: email.id,
      conversationId: raw.conversationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await storage.logActivity({
      type: "task_created",
      message: `Task created: "${draft.title}"${draft.assigneeName ? ` → ${draft.assigneeName}` : ""}${draft.dueDate ? ` (due ${draft.dueDate})` : ""}`,
      entityType: "task",
      entityId: task.id,
      createdAt: new Date().toISOString(),
    });
    return;
  }
}

export async function runWatcherOnce(): Promise<{ ingested: number }> {
  if (running) return { ingested: 0 };
  running = true;
  let ingested = 0;
  try {
    const raws = await fetchNewEmails(lookbackSinceIso());
    for (const raw of raws) {
      const before = await storage.getEmailByMessageId(raw.messageId);
      if (before) continue;
      await processEmail(raw);
      ingested++;
    }
    lastRunAt = new Date().toISOString();
    await storage.logActivity({
      type: "watcher_run",
      message: `Watcher checked inbox — ${ingested} new email${ingested === 1 ? "" : "s"} processed`,
      entityType: "system",
      entityId: null,
      createdAt: lastRunAt,
    });
  } catch (err) {
    console.error("[watcher] run failed:", err);
  } finally {
    running = false;
  }
  return { ingested };
}

export function getWatcherStatus() {
  return {
    source: usingRealGraph ? "microsoft_graph" : "mock_demo_feed",
    lastRunAt,
    intervalMinutes: WATCH_INTERVAL_MS / 60000,
  };
}

export async function startWatcher() {
  // On first boot, if running the demo feed, prime the full set so the
  // dashboard is populated immediately rather than empty.
  if (!usingRealGraph) {
    const existing = await storage.listEmails();
    if (existing.length === 0) {
      const all = primeMockFull();
      for (const raw of all) await processEmail(raw);
      lastRunAt = new Date().toISOString();
      await storage.logActivity({
        type: "watcher_run",
        message: `Initial sync — ${all.length} emails processed from demo feed`,
        entityType: "system",
        entityId: null,
        createdAt: lastRunAt,
      });
    }
  } else {
    await runWatcherOnce();
  }
  setInterval(runWatcherOnce, WATCH_INTERVAL_MS);
  console.log(`[watcher] started — source: ${usingRealGraph ? "Microsoft Graph" : "demo feed"}, every 10 min`);
}
