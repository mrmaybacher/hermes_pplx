# Hermes — Self-Hosting Guide (Full AI)

This guide gets Hermes running on **your own server** with the full GPT
extraction intact. Self-hosting is the recommended production setup: you keep
the smart AI task/contract detection, your credentials stay on your box, and
you control the database.

Everything you saw working in the demo — Microsoft Graph email reading, the
recipient gate (only acts when `hermes@angelsestate.bg` is in To/CC), the
Jarvis dashboard — runs unchanged. The only thing you provide that the
Perplexity sandbox provided for free is an **OpenAI API key**.

---

## What you need

1. A server that can run Node.js 20+ (any of: a small VPS like Hetzner /
   DigitalOcean / Linode, an AWS EC2 instance, a Raspberry Pi on your LAN, or
   even your own laptop for testing).
2. Your **Azure app credentials** (the same three you already have):
   - `GRAPH_TENANT_ID`
   - `GRAPH_CLIENT_ID`
   - `GRAPH_CLIENT_SECRET`
   - with **Mail.Read (Application)** permission + admin consent (already done).
3. An **OpenAI API key** — create one at
   https://platform.openai.com/api-keys (starts with `sk-`).

---

## Option A — Run directly with Node (simplest)

```bash
# 1. Get the code onto your server (unzip the source tarball, or git clone)
cd hermes

# 2. Install dependencies
npm install

# 3. Create your .env from the template
cp .env.example .env
nano .env          # fill in the values (see below)

# 4. Build the production bundle
npm run build

# 5. Start it
npm run start      # serves on http://localhost:5000
```

Your `.env` should look like:

```ini
GRAPH_TENANT_ID=32f3364d-7ba2-4d5b-9450-69f6821883f4
GRAPH_CLIENT_ID=39b59ac8-a1b7-42fe-8a18-64b14acf079d
GRAPH_CLIENT_SECRET=Z2l8Q~...your-secret-value...
GRAPH_MAILBOX=hermes@angelsestate.bg

OPENAI_API_KEY=sk-...your-openai-key...
HERMES_MODEL=gpt-4o
HERMES_LOOKBACK_DAYS=3

PORT=5000
NODE_ENV=production
```

> **Important — the model name.** In the Perplexity sandbox the model alias was
> `gpt_5_4`, which only resolves on the Perplexity proxy. On your own server
> with a real OpenAI key you must use a real OpenAI model name. Recommended:
> `gpt-4o` (best quality) or `gpt-4o-mini` (cheapest). Set it via `HERMES_MODEL`.

Open `http://your-server:5000` and you're live. The watcher reads the inbox
immediately on boot and then every 10 minutes.

---

## Option B — Keep it running 24/7 with PM2

Node by itself stops when you close the terminal. Use a process manager so
Hermes survives reboots and restarts on crash:

```bash
npm install -g pm2

npm run build
pm2 start "npm run start" --name hermes
pm2 save
pm2 startup        # follow the printed command to enable boot persistence
```

Useful commands: `pm2 logs hermes`, `pm2 restart hermes`, `pm2 stop hermes`.

---

## Option C — Docker

A `Dockerfile` is included. Build and run:

```bash
docker build -t hermes .
docker run -d --name hermes \
  --env-file .env \
  -p 5000:5000 \
  -v hermes_data:/app/data \
  hermes
```

The named volume `hermes_data` keeps your SQLite database across container
restarts. (The app writes `data.db` in the working directory; mount a volume
there if you change the path.)

---

## Putting it behind a domain (HTTPS)

For production you'll want it reachable at e.g. `https://hermes.angelsestate.bg`
with a TLS certificate. The easiest path is **Caddy** (auto-HTTPS):

```
# /etc/caddy/Caddyfile
hermes.angelsestate.bg {
    reverse_proxy localhost:5000
}
```

`sudo systemctl reload caddy` and Caddy fetches a Let's Encrypt cert
automatically. Nginx + Certbot works too if you prefer.

Point a DNS A record for `hermes.angelsestate.bg` at your server's IP first.

---

## Database / persistence

Hermes uses **SQLite** — a single file `data.db` in the project root. This is
genuinely durable on your own server (unlike the ephemeral sandbox): it's a
real file on your disk, backed up by whatever backs up your server.

- To back it up: just copy `data.db` (or `sqlite3 data.db ".backup backup.db"`).
- To start fresh: stop Hermes, delete `data.db*`, restart.
- Want Postgres instead? The app uses Drizzle ORM, so it can be migrated, but
  SQLite is perfectly fine for a single-mailbox personal command center.

---

## Locking the Azure app to one mailbox (recommended hardening)

Right now `Mail.Read (Application)` lets the app read **all** mailboxes in the
tenant. To restrict it to only `hermes@angelsestate.bg`, create an Application
Access Policy (run in Exchange Online PowerShell as an admin):

```powershell
# Put the hermes mailbox in a mail-enabled security group first, e.g. "HermesScope"
New-ApplicationAccessPolicy `
  -AppId 39b59ac8-a1b7-42fe-8a18-64b14acf079d `
  -PolicyScopeGroupId HermesScope@angelsestate.bg `
  -AccessRight RestrictAccess `
  -Description "Restrict Hermes app to the hermes mailbox only"

# Verify
Test-ApplicationAccessPolicy -Identity hermes@angelsestate.bg `
  -AppId 39b59ac8-a1b7-42fe-8a18-64b14acf079d   # should return Granted
```

---

## Cost note (OpenAI)

Hermes makes one extraction call per *new* email it ingests (deduped by message
id, so each email is processed once). With `gpt-4o-mini` this is a fraction of a
cent per email; `gpt-4o` is higher but still small for a personal inbox. There's
also a built-in keyword fallback, so if OpenAI is ever unreachable the pipeline
keeps classifying — just less intelligently.

---

## Quick troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Tasks are vague / no assignee detected | `HERMES_MODEL` is still `gpt_5_4` (sandbox alias) or `OPENAI_API_KEY` is missing → set a real key + `gpt-4o`. |
| `Graph messages error 403 ErrorAccessDenied` | Mail.Read (Application) not granted / admin consent missing. |
| `invalid_client` on startup | Using the secret **ID** instead of the secret **Value**, or the secret expired. |
| Dashboard shows "DEMO FEED" | One or more `GRAPH_*` vars are blank — fill all three + mailbox. |
| Empty dashboard | No mail in the lookback window with `hermes@` in To/CC. Forward yourself a test email. |
