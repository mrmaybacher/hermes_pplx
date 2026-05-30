// The watcher: every 10 minutes, fetch new emails, extract intent, persist.
import { storage } from "./storage";
import { fetchNewEmails, usingRealGraph, primeMockFull } from "./emailSource";
import type { RawEmail } from "./emailSource";
import { extractFromEmail } from "./extract";

const WATCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const HERMES_ADDRESS = (process.env.GRAPH_MAILBOX || "hermes@angelsestate.bg").toLowerCase();
let running = false;
let lastRunAt: string | null = null;

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

  if (extraction.classification === "task" && extraction.task) {
    const t = extraction.task;
    // Register the assignee. If GPT found no email, synthesize a stable key
    // from the name so the same person groups together on the People board.
    if (t.assigneeName || t.assigneeEmail) {
      const email = t.assigneeEmail
        || `${t.assigneeName!.toLowerCase().replace(/\s+/g, ".")}@team`;
      await storage.upsertPerson({
        name: t.assigneeName || t.assigneeEmail!,
        email,
        createdAt: new Date().toISOString(),
      });
      // Persist the resolved email back onto the task so People can match it.
      t.assigneeEmail = email;
    }
    const task = await storage.createTask({
      title: t.title,
      description: t.description,
      assigneeName: t.assigneeName,
      assigneeEmail: t.assigneeEmail,
      dueDate: t.dueDate,
      priority: t.priority,
      status: "open",
      sourceEmailId: email.id,
      conversationId: raw.conversationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await storage.logActivity({
      type: "task_created",
      message: `Task created: "${t.title}"${t.assigneeName ? ` → ${t.assigneeName}` : ""}${t.dueDate ? ` (due ${t.dueDate})` : ""}`,
      entityType: "task",
      entityId: task.id,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  if (extraction.classification === "contract" && extraction.contract) {
    const c = extraction.contract;
    // Dedupe: if a contract already exists for this email thread, skip creating
    // a second one (FW:/Re: of the same document arrive as separate messages).
    if (raw.conversationId) {
      const existing = await storage.findContractByConversation(raw.conversationId);
      if (existing) {
        await storage.logActivity({
          type: "contract_duplicate",
          message: `Duplicate contract email ignored for "${existing.title}"`,
          entityType: "contract",
          entityId: existing.id,
          createdAt: new Date().toISOString(),
        });
        return;
      }
    }
    const contract = await storage.createContract({
      title: c.title,
      counterparty: c.counterparty,
      counterpartyEmail: c.counterpartyEmail,
      status: "awaiting_signature",
      attachmentName: raw.attachmentName || null,
      sourceEmailId: email.id,
      conversationId: raw.conversationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await storage.logActivity({
      type: "contract_created",
      message: `Contract awaiting signature: "${c.title}"${c.counterparty ? ` with ${c.counterparty}` : ""}`,
      entityType: "contract",
      entityId: contract.id,
      createdAt: new Date().toISOString(),
    });
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
