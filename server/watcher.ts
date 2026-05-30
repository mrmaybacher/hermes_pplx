// The watcher: every 10 minutes, fetch new emails, extract intent, persist.
import { storage } from "./storage";
import { fetchNewEmails, usingRealGraph, primeMockFull, splitThread } from "./emailSource";
import type { RawEmail } from "./emailSource";
import { extractFromEmail } from "./extract";
import { HERMES_ADDRESS, OWNER_ADDRESS, inferAssignee } from "./assignee";
import type { Email } from "@shared/schema";

// Worker cadence + active-hours window (all env-configurable).
const WATCH_INTERVAL_MIN = Number(process.env.HERMES_WATCH_INTERVAL_MIN ?? 60);
const WATCH_INTERVAL_MS = WATCH_INTERVAL_MIN * 60 * 1000;
const ACTIVE_START = Number(process.env.HERMES_ACTIVE_START ?? 7);  // inclusive
const ACTIVE_END = Number(process.env.HERMES_ACTIVE_END ?? 19);     // inclusive
const ACTIVE_TZ = process.env.HERMES_TZ || "Europe/Sofia";
let running = false;
let lastRunAt: string | null = null;

// A normalised task draft, shared by the task-like path and the reply fallback.
export interface TaskDraft {
  title: string;
  description: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  dueDate: string | null;
  priority: "high" | "medium" | "low";
}

// Build a task from an email + draft: infer/assign the owner, upsert the person,
// create the task, and log task_created. Shared by the normal task path and the
// unlinked-reply fallback so both behave identically.
export async function createTaskFromEmail(raw: RawEmail, email: Email, draft: TaskDraft, activityMessage?: string): Promise<void> {
  // 1B — infer the assignee from To/CC when GPT left it blank OR when GPT set
  // the assignee to the owner/Hermes themselves. Treating owner/Hermes-as-
  // assignee like null lets a more specific To recipient (e.g. agro@) win.
  const gptAssigneeIsOwnerOrHermes =
    !!draft.assigneeEmail &&
    [OWNER_ADDRESS, HERMES_ADDRESS].includes(draft.assigneeEmail.toLowerCase());
  if ((!draft.assigneeName && !draft.assigneeEmail) || gptAssigneeIsOwnerOrHermes) {
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
    message: activityMessage
      ?? `Task created: "${draft.title}"${draft.assigneeName ? ` → ${draft.assigneeName}` : ""}${draft.dueDate ? ` (due ${draft.dueDate})` : ""}`,
    entityType: "task",
    entityId: task.id,
    createdAt: new Date().toISOString(),
  });
}

// Strip a leading reply/forward prefix (RE:/FW:/FWD:) from a subject.
export function stripReplyPrefix(subject: string): string {
  let s = (subject || "").trim();
  while (/^(re|fw|fwd)\s*:/i.test(s)) {
    s = s.replace(/^(re|fw|fwd)\s*:/i, "").trim();
  }
  return s;
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

// Full-inbox sentinel. Each scan asks Graph for all inbox messages newest-first;
// messageId deduplication below prevents already-ingested mail from reprocessing.
const FULL_INBOX_SINCE_ISO = "1970-01-01T00:00:00Z";

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
      threadJson: null,
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

  // Parse a multi-message body into an ordered chain (3a). Stored additively so
  // the detail view can render the full thread. Empty array → no clear split.
  // TODO(3b): optionally enrich with Graph conversationId siblings via
  // fetchConversation(raw.conversationId); deferred to keep ingestion safe.
  const segments = splitThread(raw.body);

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
    threadJson: segments.length ? JSON.stringify(segments) : null,
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

    // Linked to an existing task/contract → keep the current behavior: record the
    // thread message + log "reply_linked", then stop.
    if (linkedTask || linkedContract) {
      const target = linkedTask ? `task "${linkedTask.title}"` : `contract "${linkedContract!.title}"`;
      await storage.logActivity({
        type: "reply_linked",
        message: `Reply from ${raw.fromName} linked to ${target}`,
        entityType: linkedTask ? "task" : "contract",
        entityId: linkedTask?.id ?? linkedContract!.id,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    // Untracked thread → previously dropped. Now surface it as a task so a real,
    // actionable reply/forward isn't silently lost.
    const title = stripReplyPrefix(raw.subject) || "(no subject)";
    await createTaskFromEmail(
      raw,
      email,
      {
        title,
        description: raw.body || raw.bodyPreview || "",
        assigneeName: null,
        assigneeEmail: null,
        dueDate: null,
        priority: "medium",
      },
      `Task created from reply/forward: "${title}"`,
    );
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
    const draft: TaskDraft = extraction.task
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
          assigneeName: null,
          assigneeEmail: null,
          dueDate: null,
          priority: "medium",
        };

    await createTaskFromEmail(raw, email, draft);
    return;
  }
}

export async function runWatcherOnce(): Promise<{ ingested: number }> {
  if (running) return { ingested: 0 };
  running = true;
  let ingested = 0;
  try {
    const raws = await fetchNewEmails(FULL_INBOX_SINCE_ISO);
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

// Current hour (0–23) in the configured timezone.
function hourInTz(): number {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: ACTIVE_TZ,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  // en-GB may render "24" for midnight; normalise to 0.
  const h = parseInt(s, 10);
  return Number.isFinite(h) ? h % 24 : new Date().getHours();
}

// True when the local hour is within [ACTIVE_START, ACTIVE_END] inclusive.
function withinActiveWindow(): boolean {
  const h = hourInTz();
  return h >= ACTIVE_START && h <= ACTIVE_END;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function activeWindowLabel(): string {
  return `${pad2(ACTIVE_START)}:00–${pad2(ACTIVE_END)}:00 ${ACTIVE_TZ}`;
}

// The scheduled tick: only runs during the active window; paused overnight.
async function scheduledTick(): Promise<void> {
  if (!withinActiveWindow()) return;
  await runWatcherOnce();
}

export function getWatcherStatus() {
  return {
    source: usingRealGraph ? "microsoft_graph" : "mock_demo_feed",
    lastRunAt,
    intervalMinutes: WATCH_INTERVAL_MIN,
    activeWindow: activeWindowLabel(),
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
    // Real Graph: sync once on startup regardless of the active window.
    await runWatcherOnce();
  }
  // Scheduled hourly tick, gated to the active window (paused overnight).
  setInterval(scheduledTick, WATCH_INTERVAL_MS);
  console.log(
    `[watcher] started — source: ${usingRealGraph ? "Microsoft Graph" : "demo feed"}, ` +
    `every ${WATCH_INTERVAL_MIN} min, active ${activeWindowLabel()}`
  );
}
