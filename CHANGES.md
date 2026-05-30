# Hermes Redesign — Changes

Redesign of Hermes into a light, Apple-styled email-to-task command center. Stack
unchanged (React + TS + Vite frontend, Express + Drizzle + better-sqlite3 backend).
No commits, no deploy.

## Part 1 — Backend

### 1A. Drop "contracts" as a separate concept
- **`server/watcher.ts`** — Removed the separate contract branch. Contract-like
  extractions (`extraction.contract`) are now normalized into the same `draft` shape
  as tasks and flow through the unified task-creation path. No more `createContract`
  calls; every actionable email becomes a task.
- **`server/routes.ts`** — `/api/contracts` now returns `[]` (retired, kept so any
  stale client cannot 404).
- **`shared/schema.ts`** — The `contracts` table and its `Contract`/`InsertContract`
  types are **kept as harmless legacy** (no migration drops production data), but
  nothing writes to it anymore.
- **`client/src/lib/api.ts`** — Removed the `Contract` type and its export; dropped
  contracts from `StatusResponse`.

### 1B. Infer assignee from To/CC
- **`shared/schema.ts`** — Added `ccRecipients: text("cc_recipients").notNull().default("[]")`
  to the `emails` table.
- **`server/storage.ts`** — Added `cc_recipients` to the `CREATE TABLE emails`
  statement, plus a **safe additive migration** (`ensureColumn` via `PRAGMA table_info`
  + guarded `ALTER TABLE ADD COLUMN`) so the existing production `data.db` gains the
  column with default `'[]'` without losing rows.
- **`server/watcher.ts`** — Added `inferAssignee(raw)`: when GPT leaves the assignee
  null, pick the first To recipient (then CC), **excluding** the Hermes mailbox
  (`hermes@angelsestate.bg` / `GRAPH_MAILBOX`) and the owner
  (`g.meriacre@angelsestate.bg`). Display name derived from the email local-part via
  `displayNameFromEmail`. Both `createEmail` calls now persist `ccRecipients`.
- **`server/emailSource.ts`** — Graph mapper maps `ccRecipients` onto the `RawEmail`.

### 1C. Forwarded emails no longer render blank
- **`server/emailSource.ts`** — New body-cleaning module:
  - `htmlToText()` converts `</p>`, `<br>`, `</div>` to newlines, strips
    script/style/tags, decodes entities, and collapses whitespace while preserving
    line breaks.
  - `resolveBody()` detects forward-header blocks (`---- Forwarded message ----`,
    `Begin forwarded message:`, `---- Original Message ----`) and drills past them to
    the real forwarded body.
  - Graph mapper: `body = resolveBody(htmlToText(raw)) || cleaned || bodyPreview` so
    the stored body is **never blank** when any content exists.
- **`client/src/components/hermes/EmailDetail.tsx`** — `splitForwarded()` separates an
  optional wrapper note from the forwarded section and renders the forwarded block in a
  labeled card. Falls back to `bodyPreview`, then a designed "Email body could not be
  extracted" placeholder.

### 1D. Extended task status
- **`shared/schema.ts`** — Status documented as `open | in_progress | done | deleted |
  cancelled`; `updateTaskSchema.status` enum updated to match.
- **`server/routes.ts`** — "Active" now means `open || in_progress` everywhere
  (`/api/status` counts, `/api/people` open/overdue counts). Added `doneTasks` and
  `archivedTasks` counts.
- **`client/src/lib/api.ts`** — Added `TaskStatus` type and `isActive()` helper;
  `isOverdue()` uses it.

### 1E. createdAt — already present, no change needed.

## Part 2 — Frontend (Light Apple)

- **`client/src/index.css`** — Full rewrite to the Light Apple design system. Removed
  dark mode and all HUD effects (canvas glow, scanlines, monospace labels). New palette
  (bg `#F5F5F7`, surfaces `#FFFFFF`, hairline `#E5E5EA`, accent `#007AFF`, success
  `#34C759`, destructive `#FF3B30`), SF/Inter font stack, 16-24px radii, soft shadows.
  Added `.apple-glass`, `.apple-surface(-hover/-selected)`, `.apple-detail`, row-leave
  + detail-enter keyframes, `:focus-visible`, and a `prefers-reduced-motion` block.
  Kept the shadcn elevate utility vars.
- **`tailwind.config.ts`** — Radii bound to `--radius`; added `success`, `warning`,
  `neutral-archive` colors.
- **`client/src/pages/Dashboard.tsx`** — Rewritten as a tabbed app: **Inbox** (default),
  **Done**, **Deleted** (All / Deleted / Cancelled filter), **Activity**, **People**.
  No Contracts tab, no four-panel layout. Inbox/Done/Deleted are master-detail. Optimistic
  actions animate the row out (`LEAVE_MS = 200ms`) then advance the selection. Mobile
  list→detail navigation via `mobileDetail` state. Sticky Apple-glass header with
  live/demo pill and Scan Inbox button.
- **`client/src/components/hermes/TaskRow.tsx`** *(new)* — Row with subject title,
  assignee chip, created date, overdue badge, and inline Done/Cancel/Delete (inbox) or
  Restore (done/archive) buttons.
- **`client/src/components/hermes/EmailDetail.tsx`** *(new)* — Detail pane: subject,
  assignee, created date, From/To/Cc/Received meta, body (with forwarded section),
  designed empty state, and thread replies.
- **`client/src/components/hermes/useTaskActions.ts`** *(new)* — TanStack Query
  optimistic mutations (`onMutate` snapshot + optimistic write, `onError` rollback +
  toast, `onSuccess` toast, `onSettled` invalidate). Exposes
  `markDone / remove / cancel / restore`.
- **`client/src/lib/api.ts`** — Added `createdLabel()`, `fullDateTime()`,
  `assigneeLabel()`, `parseRecipients()`; added `ccRecipients` to `EmailRow`.
- **`client/src/main.tsx`** — Removed the forced `#/` hash redirect.

## Part 3 — Build / production frontend

- **`script/build.ts`** — **Removed the `client_html/index.html` overwrite step.**
  Previously, after Vite built the React app to `dist/public`, the build copied a
  separate single-file dark-HUD dashboard (`client_html`) over it, so production served
  the HUD rather than the React app. With the redesign, the **Vite React output is now
  the production frontend** (matching what dev already served). `client_html` is left on
  disk but is no longer wired into the build.

  *Decision note:* this was the one ambiguous call. Since the spec's intent is to ship
  the new Light Apple React app, and dev already runs React, removing the overwrite makes
  prod consistent with dev and with the redesign. No human was available to confirm.

## Verification

- `npm run build` — exits 0, zero TypeScript errors.
- `npx tsc` — exits 0.
- Ran locally against the mock feed (`NODE_ENV=development`, port 5099):
  - 5 active tasks in Inbox; `/api/contracts` returns `[]`.
  - Contract-like emails (Vitosha lease, Collagen NDA) now appear as tasks.
  - CC persisted on emails; assignee inferred from To/CC excluding Hermes/owner.
  - Forwarded "FW: Lease agreement" detail renders a non-blank body.
- Screenshots saved to `/home/user/workspace/`: `hermes_inbox.png`,
  `hermes_detail.png`, `hermes_detail_forwarded.png`, `hermes_mobile.png`.
