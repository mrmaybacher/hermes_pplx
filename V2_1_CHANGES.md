# Hermes v2.1 — Changes

Three targeted changes plus one new admin endpoint. All DB changes are additive/
idempotent (no schema changes were needed — existing columns cover everything).

## Change 1 — Re-process / re-extract admin endpoint + UI button

A one-click admin action that re-fetches each stored email's ORIGINAL raw body
from Microsoft Graph by `messageId`, re-runs the CURRENT parsing + assignee
inference, and updates the stored email and its linked task **in place**. This is
the only way to retroactively fix records ingested by old code (e.g. flattened
bodies, null assignees).

- `server/emailSource.ts`: new `fetchMessageById(messageId)` → `RawEmail | null`,
  reusing the existing token + `htmlToText`/`resolveBody` logic.
- `server/storage.ts`: new `updateEmail(id, patch)` and
  `listTasksBySourceEmail(emailId)` (both added to `IStorage`).
- `server/assignee.ts` (new): `displayNameFromEmail`, `inferAssignee`, and the
  `HERMES_ADDRESS`/`OWNER_ADDRESS` constants moved here so both the watcher and
  the reprocess path share identical logic without a circular import.
- `server/reprocess.ts` (new): `reprocessAll()` → `{ scanned, updated, skipped }`.
  Idempotent and non-destructive: never nulls a real (non-owner/non-Hermes)
  assignee, and only refreshes a task description when it matches the stale
  pattern `/\d+\.\r?\n/` or is empty. Logs an `email_reprocessed` activity row
  per updated email.
- `client/src/lib/api.ts`: `api.reprocess()` → `POST /api/admin/reprocess`.
- `client/src/pages/Dashboard.tsx`: secondary "Re-process" button next to "Scan
  Inbox" (uses theme tokens, works in light + dark). On success shows a toast
  `Re-processed: N updated, M skipped` and re-fetches tasks/status/people/activity.

## Change 2 — Assignee backfill correctness

Covered by Change 1: reprocess reuses the exact same `inferAssignee` + person-
upsert logic, so an email sent To `agro@angelsestate.bg` yields assignee name
"Agro" / email "agro@angelsestate.bg". New ingestion already handled this — no
change to the new-email flow.

## Change 3 — Scan reliability: unlinked replies become tasks

In `server/watcher.ts` `processEmail`, a reply/forward that couldn't be linked to
any existing task or contract used to be dropped silently. Now:

- Linked to a task/contract → unchanged behavior (record thread message, log
  `reply_linked`, return).
- Linked to nothing → fall through and create a task from the email itself
  (title = subject with leading RE:/FW:/FWD: stripped; description = body or
  preview; same assignee inference + person upsert; priority "medium"; status
  "open"). Logs `task_created` noting it came from a reply/forward.

Refactor: the existing task-creation block was extracted into a shared local
helper `createTaskFromEmail(raw, email, draft, activityMessage?)`, called by both
the normal task-like path and the unlinked-reply fallback. The normal path's
behavior is unchanged.

## New endpoint

`POST /api/admin/reprocess` → `{ scanned, updated, skipped }`.
