# Hermes v2 — Changes

Seven follow-up changes layered on the Light Apple redesign. All SQLite schema
changes are additive & idempotent (existing prod `data.db` is never dropped).
The production frontend remains the Vite React app (no HUD overwrite).

### 1. Dark theme + persisted toggle button
- **`client/src/index.css`** — Added a `.dark` selector overriding the same CSS
  variables with a dark Apple palette (bg `#000`, surfaces `#1C1C1E`, elevated
  `#2C2C2E`, hairline `#38383A`, text `#F5F5F7`/`#A1A1A6`, accent `#0A84FF`,
  success `#30D158`, destructive `#FF453A`). Hardcoded surface hexes in
  `.apple-glass/.apple-surface/.apple-detail` now read from new variables
  (`--glass-bg`, `--surface-bg`, `--surface-subtle`, `--surface-selected-grad-to`,
  scrollbar tokens) so both themes recolour automatically. Added a theme-aware
  webkit scrollbar on `.apple-scroll-col`.
- **`client/src/components/hermes/ThemeToggle.tsx`** *(new)* — Sun/Moon pill
  button. Toggles `<html>.dark`, persists to `localStorage["hermes-theme"]`,
  defaults to LIGHT when unset (manual, never auto-follows system).
- **`client/index.html`** — Inline `<head>` script applies the saved class
  before first paint (no flash).
- **`client/src/pages/Dashboard.tsx`** — ThemeToggle placed in the header next to
  Scan Inbox; live/demo pill + People overdue colours moved to theme tokens.
- **`TaskRow.tsx` / `EmailDetail.tsx`** — Hardcoded action/badge/surface hexes
  replaced with `success`/`destructive`/`secondary` tokens and `bg-secondary/*`.

### 2. Email body formatting (numbered/bulleted lists)
- **`server/emailSource.ts`** — `htmlToText()` now runs a stateful `markListItems`
  pass FIRST: it tracks an `<ol>`/`<ul>` stack and rewrites each `<li>` to a
  leading `\n1. ` (per-ol counter) or `\n• `. `<li>` was removed from the generic
  block-newline rule so markers aren't double-inserted. A 6-point `<ol>` now
  renders as 6 consecutive numbered lines.

### 3. Full email thread / chain rendering
- **`server/emailSource.ts`** — New exported `splitThread(body)` →
  `ThreadSegment[]` splits a cleaned body on forward separators and repeated
  `From:/Sent:/To:/Subject:` header blocks, parsing each header block into
  fields. Returns `[]` when there is no clear multi-message split. Defensive
  (never throws). Also added best-effort `fetchConversation(conversationId)`
  (3b) for Graph `conversationId` siblings — implemented but **not yet wired**
  into ingestion (see TODO); 3a in-body parsing is the primary chain source.
- **`shared/schema.ts`** — Added additive nullable `threadJson` (`thread_json
  TEXT`) to `emails`, plus `threadJson` on the `Email`/`InsertEmail` types.
- **`server/storage.ts`** — `thread_json` added to `CREATE TABLE emails` and a
  guarded `ensureColumn("emails","thread_json","TEXT")` migration.
- **`server/watcher.ts`** — `processEmail` computes `splitThread(raw.body)` and
  persists it as JSON on the processed email (null for the "other" path).
- **`server/routes.ts`** — `/api/tasks/:id/detail` now returns `threadSegments`
  (parsed from the source email's `threadJson`, default `[]`).
- **`client/src/lib/api.ts`** — Added `ThreadSegment`, `threadSegments` on
  `TaskDetail`, `threadJson` on `EmailRow`.
- **`client/src/components/hermes/EmailDetail.tsx`** — Replaced `splitForwarded`
  with a stacked chain view: when `threadSegments.length > 1` it renders one
  `ChainCard` per message (muted From/Sent/To/Subject header + `whitespace-pre-wrap`
  body) using theme-aware surfaces. Single-body fallback otherwise; existing
  conversation replies still shown below.

### 4. Assignee inference (agro@ → Agro)
- **`server/watcher.ts`** — Recipient inference now also triggers when GPT set the
  assignee to the owner or Hermes address (treated like null), so a specific To
  recipient such as `agro@angelsestate.bg` wins → "Agro". `displayNameFromEmail`
  capitalization unchanged.

### 5. Search across ALL tasks
- **`server/storage.ts`** — `searchTasks(q)` loads all tasks + a map of all emails
  and matches (case-insensitive substring) on task title/description/assignee and
  the source email subject/body/from; returns enriched rows with a `snippet`
  excerpt and `sourceSubject`. Blank `q` → `[]`.
- **`server/routes.ts`** — `GET /api/search?q=...`.
- **`client/src/lib/api.ts`** — Added `SearchResult` type.
- **`client/src/components/hermes/SearchResults.tsx`** *(new)* — Master-detail
  results view; each row shows title, a status chip (Open/Done/Deleted/Cancelled),
  assignee, created date, and snippet; clicking opens the task in `EmailDetail`.
- **`client/src/pages/Dashboard.tsx`** — Rounded search pill (lucide `Search`,
  clear `X`) in the header, debounced ~250ms; a non-empty query swaps the main
  area to `<SearchResults>` while keeping tabs visible. `StatusChip` exported from
  `TaskRow.tsx`.

### 6. Tab order
- **`client/src/pages/Dashboard.tsx`** — `TABS` reordered to Inbox, **People**,
  Done, Deleted, Activity. Badge logic (inbox/done/deleted) unaffected.

### 7. Worker schedule (hourly, 07:00–19:00 Europe/Sofia, paused overnight)
- **`server/watcher.ts`** — The fixed 10-min `setInterval(runWatcherOnce)` is now
  an hourly `scheduledTick` gated to the active window: it computes the current
  hour in `Europe/Sofia` via `Intl.DateTimeFormat` and only runs when
  `hour >= ACTIVE_START && hour <= ACTIVE_END` (7–19 inclusive). Env-configurable:
  `HERMES_WATCH_INTERVAL_MIN` (60), `HERMES_ACTIVE_START` (7), `HERMES_ACTIVE_END`
  (19), `HERMES_TZ` (Europe/Sofia). First-boot sync still runs once regardless of
  window (real Graph) / primes the demo feed. Manual `POST /api/watcher/run`
  ("Scan Inbox") unchanged. `getWatcherStatus()` now reports `intervalMinutes` and
  `activeWindow` (e.g. "07:00–19:00 Europe/Sofia"), surfaced in the pill tooltip.

### TODOs
- **3b** — `fetchConversation()` exists but is not wired into ingestion. Follow-up:
  in `watcher.processEmail` (or a post-pass), merge Graph `conversationId` siblings
  into the persisted chain. Deferred to keep ingestion safe; 3a covers the
  forwarded-thread screenshot case.

---

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
