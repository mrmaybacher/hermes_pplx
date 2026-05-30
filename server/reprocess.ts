// Admin re-process: re-fetch each stored email's ORIGINAL body from Graph,
// re-run the CURRENT parsing + assignee inference, and UPDATE the stored email
// and its linked task IN PLACE. Idempotent and non-destructive — running it
// twice yields the same result and never deletes data.
import { storage } from "./storage";
import { fetchMessageById, splitThread } from "./emailSource";
import { inferAssignee, HERMES_ADDRESS, OWNER_ADDRESS } from "./assignee";

// A description that still looks like raw/garbled ingestion text: a number-dot
// immediately followed by a newline (e.g. "  1.\r\nv zadnata chast...").
const STALE_DESCRIPTION = /\d+\.\r?\n/;

export async function reprocessAll(): Promise<{ scanned: number; updated: number; skipped: number }> {
  const emails = await storage.listEmails();
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const email of emails) {
    // Only Hermes-relevant emails (skip the audit-only "other" ones).
    if (email.classification === "other") continue;
    scanned++;

    const raw = await fetchMessageById(email.messageId);

    // Message deleted/unreachable. Fallback: if a stored body exists, refresh
    // thread_json from it; otherwise skip. Never fabricate a body.
    if (!raw) {
      if (email.body) {
        const segments = splitThread(email.body);
        await storage.updateEmail(email.id, {
          threadJson: segments.length ? JSON.stringify(segments) : null,
        });
      }
      skipped++;
      continue;
    }

    const segments = splitThread(raw.body);
    await storage.updateEmail(email.id, {
      body: raw.body,
      threadJson: segments.length ? JSON.stringify(segments) : null,
      toRecipients: JSON.stringify(raw.toRecipients),
      ccRecipients: JSON.stringify(raw.ccRecipients),
    });

    const linked = await storage.listTasksBySourceEmail(email.id);
    for (const task of linked) {
      const patch: Record<string, unknown> = {};

      // Recompute assignee ONLY if the task has no assignee or its assignee is
      // the owner/Hermes — never wipe a real (manually-set) assignee.
      const currentEmail = (task.assigneeEmail || "").toLowerCase();
      const assigneeIsOwnerOrHermes =
        !!currentEmail && [OWNER_ADDRESS, HERMES_ADDRESS].includes(currentEmail);
      if (!task.assigneeName && !task.assigneeEmail || assigneeIsOwnerOrHermes) {
        const inferred = inferAssignee(raw);
        if (inferred.name || inferred.email) {
          const personEmail = inferred.email
            || `${inferred.name!.toLowerCase().replace(/\s+/g, ".")}@team`;
          await storage.upsertPerson({
            name: inferred.name || inferred.email!,
            email: personEmail,
            createdAt: new Date().toISOString(),
          });
          patch.assigneeName = inferred.name;
          patch.assigneeEmail = personEmail;
        }
        // If inference yields nothing, leave the assignee unchanged.
      }

      // Refresh the description ONLY if it looks like raw/garbled ingestion text
      // or is empty — never clobber a GPT-summarized or hand-edited description.
      const desc = task.description || "";
      if (!desc || STALE_DESCRIPTION.test(desc)) {
        patch.description = raw.body;
      }

      if (Object.keys(patch).length) {
        await storage.updateTask(task.id, patch as any);
      }
    }

    await storage.logActivity({
      type: "email_reprocessed",
      message: `Re-processed "${email.subject}" — refreshed body & assignee`,
      entityType: "email",
      entityId: email.id,
      createdAt: new Date().toISOString(),
    });
    updated++;
  }

  return { scanned, updated, skipped };
}
