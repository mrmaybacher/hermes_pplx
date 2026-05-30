# Hermes — Live Deploy Guide (Hetzner + Cloudflare Tunnel + Auto-Deploy)

This gets Hermes running 24/7 on your Hetzner server, reachable on a clean HTTPS
URL via Cloudflare Tunnel, with **automatic redeploy on every `git push`**.

Total time: ~20 minutes. You do it once; after that it's just `git push`.

---

## What you need before starting
- A Hetzner server (Ubuntu 22.04 or 24.04). The cheapest CX22 (~€4/mo) is plenty.
- A domain on Cloudflare (e.g. `angelsestate.bg`) — free Cloudflare account.
- Your secrets: Graph client secret, OpenAI key.

---

## STEP 1 — Put the code on GitHub

1. Create a new **private** repo on GitHub, e.g. `hermes`.
2. From the project folder on your machine:
   ```bash
   git init && git add -A && git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/YOUR_USER/hermes.git
   git push -u origin main
   ```

---

## STEP 2 — Create the Cloudflare Tunnel (gives you the HTTPS URL)

1. Go to **Cloudflare Zero Trust dashboard** → **Networks → Tunnels → Create a tunnel**.
2. Choose **Cloudflared**, name it `hermes`.
3. Cloudflare shows an install command containing a **token** (a long string after
   `--token`). **Copy that token** — that's your `CLOUDFLARE_TUNNEL_TOKEN`.
4. Under **Public Hostnames**, add:
   - Subdomain: `hermes`  |  Domain: `angelsestate.bg`  →  `hermes.angelsestate.bg`
   - Service: **HTTP**  →  `hermes:5000`   (this is the docker service name + port)
5. Save. (DNS is created automatically by Cloudflare.)

---

## STEP 3 — Set up the server

SSH into your Hetzner box and run:

```bash
ssh root@YOUR_SERVER_IP
# Install Docker + clone the repo
curl -fsSL https://get.docker.com | sh
git clone https://github.com/YOUR_USER/hermes.git /opt/hermes
cd /opt/hermes
cp .env.production.example .env
nano .env        # fill in the 3 real secrets (see below), then Ctrl+O, Enter, Ctrl+X
```

In `.env`, set these to your real values:
- `GRAPH_CLIENT_SECRET=...`
- `OPENAI_API_KEY=sk-...`
- `CLOUDFLARE_TUNNEL_TOKEN=...`   (from Step 2)

Then start it:
```bash
docker compose up -d --build
docker compose ps      # both 'hermes' and 'hermes_tunnel' should be Up
```

Open **https://hermes.angelsestate.bg** — your dashboard is live.

---

## STEP 4 — Turn on auto-deploy (push code → live in ~60s)

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add these four:

| Secret name        | Value                                                        |
|--------------------|--------------------------------------------------------------|
| `HETZNER_HOST`     | your server IP                                               |
| `HETZNER_USER`     | `root`                                                       |
| `HETZNER_PORT`     | `22`                                                         |
| `HETZNER_SSH_KEY`  | a private SSH key whose public half is in the server's `~/.ssh/authorized_keys` |

To make an SSH key for this (run locally):
```bash
ssh-keygen -t ed25519 -f hermes_deploy -N ""
# copy the PUBLIC key to the server:
ssh-copy-id -i hermes_deploy.pub root@YOUR_SERVER_IP
# paste the PRIVATE key file contents (hermes_deploy) into HETZNER_SSH_KEY secret
```

Done. Now every `git push` to `main` rebuilds and restarts Hermes automatically.
You can also trigger it manually from the repo's **Actions** tab.

---

## How updates work from now on
1. I (or you) change code locally.
2. `git push`.
3. GitHub Actions SSHes in, pulls, `docker compose up -d --build`, restarts.
4. New version live at the same URL in ~60 seconds. SQLite data persists.

---

## Notes
- **Recipient gate:** an email becomes a task only if `hermes@angelsestate.bg` is in
  To or CC. Everything else is stored as "other" and ignored. (Unchanged spec.)
- **Polling:** every 10 minutes automatically. The "SCAN INBOX" button forces an
  immediate check.
- **Data:** SQLite lives in the `hermes_data` Docker volume — survives restarts and
  redeploys.
- **Security:** no server ports are exposed to the internet; Cloudflare reaches the
  app through the encrypted tunnel only.
