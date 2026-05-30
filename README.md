# Hermes — Email-to-Task Command Center

Hermes reads the inbox at `hermes@angelsestate.bg`, figures out what each email
means (a task, a contract to sign, or a reply to something already tracked),
extracts **who** must do it and **by when**, and shows everything on a live
dashboard: what's open, what's overdue, and who owes you.

---

## The three layers

### 1. The Watcher (`server/watcher.ts`)
Every **10 minutes** it logs into the inbox, reads new mail received **today
onward**, and for each message:
- Dedupes on the provider message-id, so an email is never processed twice.
- Sends the email to the **GPT extraction engine** (`server/extract.ts`).
- Classifies it: `task` · `contract` · `reply` · `other`.
- Writes the result to the database and logs an activity entry.
- Replies are matched to the existing task/contract by conversation id and
  appended to that thread.

The email source (`server/emailSource.ts`) is **env-gated**:
- **Real mode** — if `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, and
  `GRAPH_CLIENT_SECRET` are set, it reads your real Microsoft 365 inbox via the
  Graph API.
- **Demo mode** — with no Graph credentials, it runs a realistic built-in feed
  so the whole pipeline is demonstrable. **No code change** is needed to switch.

### 2. The Database (SQLite, `data.db`)
Tables: `emails`, `tasks`, `people`, `contracts`, `thread_messages`,
`activity`. Created automatically on first boot. The file is `data.db` in the
project root — back it up to keep your history.

### 3. The Dashboard (`client/`)
React + Tailwind. Four sections, auto-refreshing every **5 minutes**:
- **Tasks** — the priority stack (overdue first, then by priority and due date),
  with one-click status changes.
- **People** — who has open items, and how many are overdue.
- **Contracts** — signature tracking.
- **Activity** — a full audit log of everything Hermes did.

---

## Run locally

```bash
npm install
npm run dev          # dev server on http://localhost:5000
```

Build + run production:

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

---

## Going live: connect your real inbox (Microsoft Graph)

You need an Azure app registration with permission to read the Hermes mailbox.
This is a one-time, ~5-minute setup in your Microsoft 365 / Azure admin.

1. **Azure Portal → Microsoft Entra ID → App registrations → New registration.**
   - Name: `Hermes Watcher`. Supported account types: *single tenant*. Register.
2. On the app's **Overview** page, copy:
   - **Application (client) ID** → `GRAPH_CLIENT_ID`
   - **Directory (tenant) ID** → `GRAPH_TENANT_ID`
3. **Certificates & secrets → New client secret.** Copy the secret **Value**
   (not the ID) → `GRAPH_CLIENT_SECRET`. (You can only see it once.)
4. **API permissions → Add a permission → Microsoft Graph → Application
   permissions → `Mail.Read`** (add `Mail.ReadWrite` only if you later want
   Hermes to mark mail as read). Then click **Grant admin consent**.
5. (Recommended — least privilege) Restrict the app to ONLY the Hermes mailbox
   so it can't read every inbox in the tenant. In Exchange Online PowerShell:
   ```powershell
   New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
     -PolicyScopeGroupId hermes@angelsestate.bg `
     -AccessRight RestrictAccess -Description "Hermes mailbox only"
   ```
6. Put the values in `.env` (see `.env.example`) and restart. Hermes
   auto-detects them and switches from the demo feed to your live inbox.

### GPT engine
Set `OPENAI_API_KEY` in `.env`. Default model is `gpt_5_4`; override with
`HERMES_MODEL`. If the GPT call ever fails, Hermes falls back to a keyword
heuristic so the pipeline never stalls.

---

## How forwarding works

Have your team CC or forward business emails to `hermes@angelsestate.bg`. Hermes
reads that mailbox directly — it doesn't need access to your personal inbox.
Subject lines starting with `RE:`/`FW:` are treated as replies and linked to the
original task or contract by their conversation thread.

---

## File map

```
server/
  emailSource.ts   Graph fetch + demo feed (env-gated), same RawEmail shape
  extract.ts       GPT classification + field extraction (Responses API)
  watcher.ts       10-min loop, dedup, persistence, reply-linking, activity log
  routes.ts        REST API (status, tasks, people, contracts, activity)
  storage.ts       SQLite schema creation + all CRUD
shared/schema.ts   Drizzle data model + types shared by client & server
client/src/
  pages/Dashboard.tsx   The four-section dashboard, 5-min auto-refresh
  lib/api.ts            Client types + date/format helpers
```
