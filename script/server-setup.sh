#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Hermes — one-shot Hetzner bootstrap.
# Run this ONCE on a fresh Ubuntu 22.04/24.04 Hetzner server as root.
#   ssh root@YOUR_SERVER_IP 'bash -s' < server-setup.sh
# or paste it after SSHing in.
# ──────────────────────────────────────────────────────────────
set -e

REPO_URL="${REPO_URL:-https://github.com/YOUR_GITHUB_USER/hermes.git}"
APP_DIR="/opt/hermes"

echo "==> Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Cloning repo into ${APP_DIR}..."
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> Setting up environment file..."
if [ ! -f .env ]; then
  cp .env.production.example .env
  echo ""
  echo "  !!  Edit /opt/hermes/.env now and fill in your real secrets:"
  echo "      - GRAPH_CLIENT_SECRET"
  echo "      - OPENAI_API_KEY"
  echo "      - CLOUDFLARE_TUNNEL_TOKEN"
  echo ""
  echo "  Run:  nano /opt/hermes/.env"
  echo "  Then: cd /opt/hermes && docker compose up -d --build"
  exit 0
fi

echo "==> Building and starting containers..."
docker compose up -d --build

echo "==> Done. Status:"
docker compose ps
echo ""
echo "Hermes is running. It is reachable through your Cloudflare Tunnel hostname."
