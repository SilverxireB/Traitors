# Traitors — Deployment, CI/CD & Infrastructure Runbook

> Complete ops runbook for a web-based Werewolf (Vampir Köylü / Mafia) game management tool.
> Version 1.0 · DevOps Spec

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Deployment Options — Evaluation & Ranking](#2-deployment-options--evaluation--ranking)
3. [Top 3 Recommended Deployments](#3-top-3-recommended-deployments)
4. [Docker Strategy](#4-docker-strategy)
5. [CI/CD Pipeline](#5-cicd-pipeline)
6. [Configuration Management](#6-configuration-management)
7. [Monitoring & Observability](#7-monitoring--observability)
8. [Security](#8-security)
9. [One-Click Deploy Options](#9-one-click-deploy-options)
10. [Cost Analysis](#10-cost-analysis)
11. [Domain & SSL](#11-domain--ssl)
12. [Backup & Recovery](#12-backup--recovery)

---

## 1. Architecture Overview

### What We're Deploying

```
┌──────────────────────────────────────────────────────────────┐
│                     Single Go Binary                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  REST API     │  │  WebSocket   │  │  Embedded SPA    │   │
│  │  /api/*       │  │  /ws         │  │  (Preact, static)│   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘   │
│         │                 │                  │               │
│         └────────┬────────┘                  │               │
│                  │                           │               │
│            ┌─────▼─────┐              embed.FS               │
│            │  Game      │                                    │
│            │  Engine    │                                    │
│            └─────┬─────┘                                    │
│                  │                                           │
│            ┌─────▼─────┐                                    │
│            │  SQLite    │                                    │
│            │  (file)    │                                    │
│            └────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

### Key Deployment Constraints

| Constraint | Implication |
|---|---|
| **WebSocket support required** | Rules out serverless/edge functions, short-lived containers |
| **SQLite (file-based)** | Needs persistent local disk; rules out ephemeral filesystems without volumes |
| **Single binary** | Simplifies deployment — no multi-service orchestration |
| **Long-lived connections** | Sessions last 30–90 minutes; platform must not kill idle connections |
| **Stateful in-memory** | Game state lives in Go memory; cannot horizontally scale without session affinity |
| **Small scale** | Hundreds of sessions, not millions — no need for k8s or multi-region |

---

## 2. Deployment Options — Evaluation & Ranking

### Evaluation Criteria

Each option is scored 1–5 on seven dimensions:

| Dimension | Weight | Description |
|---|---|---|
| **Ease of setup** | High | Time from zero to production. Target audience has minimal DevOps experience. |
| **WebSocket support** | Critical | Must support long-lived bidirectional connections (30–90 min). |
| **SQLite compatibility** | Critical | Must support persistent local filesystem for the database file. |
| **Cost** | High | Free tier availability and cheapest production cost. |
| **Custom domain + SSL** | Medium | Automatic TLS, custom domain without manual cert management. |
| **Cold start** | Medium | WebSocket games cannot tolerate cold starts mid-session. |
| **Operational complexity** | Medium | Ongoing maintenance, scaling, monitoring burden. |

---

### 2.1 Docker (Single Container) — ⭐ Rank #2

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 4/5 | Requires Docker knowledge, but `docker-compose up` is straightforward |
| WebSocket support | 5/5 | Full native support, no proxy quirks |
| SQLite compatibility | 5/5 | Volume mount for persistence |
| Cost | 5/5 | Free (runs on any machine) |
| Custom domain + SSL | 3/5 | Needs reverse proxy (Caddy/nginx) for TLS |
| Cold start | 5/5 | Always running, no cold starts |
| Operational complexity | 3/5 | Self-managed updates, monitoring, backups |

**Verdict:** The universal deployment unit. Works everywhere — VPS, home server, cloud VM. Combined with Caddy for automatic HTTPS, this is the most flexible option.

---

### 2.2 Fly.io — ⭐ Rank #1

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 5/5 | `fly launch` from Dockerfile, done in minutes |
| WebSocket support | 5/5 | First-class support, no timeout on WS connections |
| SQLite compatibility | 5/5 | Persistent volumes (Fly Volumes), Litestream integration |
| Cost | 4/5 | Free tier: 3 shared-cpu VMs, 1GB persistent volume. Production: ~$3–5/mo |
| Custom domain + SSL | 5/5 | Automatic TLS via `fly certs`, custom domains trivial |
| Cold start | 4/5 | Machines can be set to `always on`; min_machines_running=1 eliminates cold start |
| Operational complexity | 4/5 | Managed platform, but you own the Dockerfile |

**Verdict:** Best overall. Purpose-built for exactly this use case — long-running processes, persistent volumes for SQLite, WebSocket-native, near-zero config. The `fly.toml` + Dockerfile combo makes deployment reproducible.

---

### 2.3 Railway — Rank #4

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 5/5 | GitHub repo connect, auto-detects Dockerfile |
| WebSocket support | 4/5 | Supported, but connection timeout defaults may need tuning |
| SQLite compatibility | 3/5 | Persistent volumes available but less mature than Fly; ephemeral by default |
| Cost | 3/5 | Free tier removed (as of 2024). Hobby plan: $5/mo + usage |
| Custom domain + SSL | 5/5 | Automatic |
| Cold start | 4/5 | Always-on by default on paid plans |
| Operational complexity | 5/5 | Fully managed, minimal config |

**Verdict:** Great DX, but SQLite persistence requires explicit volume setup. Cost is higher than Fly for equivalent resources. Good second choice for PaaS if Fly.io is unavailable.

---

### 2.4 Render — Rank #5

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 4/5 | Dockerfile or native Go buildpack |
| WebSocket support | 4/5 | Supported on paid plans; free tier has limitations |
| SQLite compatibility | 2/5 | Persistent disks available only on paid plans; ephemeral filesystem on free tier |
| Cost | 3/5 | Free tier: 750 hours/month but spins down after inactivity. Paid: $7/mo |
| Custom domain + SSL | 5/5 | Automatic |
| Cold start | 2/5 | Free tier spins down after 15 min idle — kills active WebSocket sessions |
| Operational complexity | 5/5 | Fully managed |

**Verdict:** The spin-down behavior on the free tier is a dealbreaker for a real-time game. Players mid-game would lose their session. Paid tier works but is more expensive than Fly for less capability.

---

### 2.5 DigitalOcean App Platform — Rank #6

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 4/5 | Dockerfile deploy, straightforward UI |
| WebSocket support | 4/5 | Supported, requires HTTP route type configuration |
| SQLite compatibility | 2/5 | No persistent volumes on App Platform; need a Droplet instead |
| Cost | 3/5 | Basic: $5/mo. Pro: $12/mo |
| Custom domain + SSL | 5/5 | Automatic |
| Cold start | 4/5 | Always-on on paid plans |
| Operational complexity | 4/5 | Managed, but limited persistence options |

**Verdict:** App Platform's lack of persistent volumes kills SQLite support. Would need to switch to PostgreSQL or use a separate Droplet. A raw DigitalOcean Droplet ($4–6/mo) running Docker is a better option — see "Self-hosted VPS" below.

---

### 2.6 AWS (ECS / Lambda / EC2) — Rank #8

#### EC2

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 2/5 | VPC, security groups, AMI selection, SSH key management |
| WebSocket support | 5/5 | Full control |
| SQLite compatibility | 5/5 | Full disk access |
| Cost | 3/5 | t3.micro free tier (1yr), then ~$8–10/mo |
| Custom domain + SSL | 2/5 | Manual (Certbot + nginx or ALB + ACM) |
| Cold start | 5/5 | Always running |
| Operational complexity | 1/5 | Full server management: OS updates, security patches, monitoring |

#### ECS (Fargate)

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 1/5 | Task definitions, services, clusters, ALB, target groups, VPC networking |
| WebSocket support | 4/5 | Via ALB (sticky sessions needed) |
| SQLite compatibility | 2/5 | EFS mount possible but adds latency and complexity; EBS not directly supported |
| Cost | 2/5 | ALB alone costs ~$16/mo + Fargate compute |
| Operational complexity | 1/5 | Enormous complexity for a single-binary app |

#### Lambda

| Dimension | Score | Notes |
|---|---|---|
| WebSocket support | 1/5 | API Gateway WebSocket API exists but is request/response, not persistent connection |
| SQLite compatibility | 1/5 | Ephemeral /tmp, 512MB limit, no persistence |

**Verdict:** Massively over-engineered for this project. EC2 is viable but is just a more expensive, more complex VPS. ECS/Fargate is absurd overkill — you'd spend more time configuring networking than writing game code. Lambda is architecturally incompatible (no persistent WebSocket, no persistent filesystem).

---

### 2.7 Google Cloud Run — Rank #7

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 3/5 | `gcloud run deploy` from container image |
| WebSocket support | 3/5 | Supported since 2021, but 60-min timeout (configurable to max 60 min) |
| SQLite compatibility | 1/5 | Ephemeral filesystem. No persistent volumes. Must use Cloud SQL or external DB. |
| Cost | 4/5 | Generous free tier (2M requests/month) |
| Custom domain + SSL | 4/5 | Automatic, but requires domain verification |
| Cold start | 2/5 | Scales to zero by default. Min instances = 1 costs more. |
| Operational complexity | 3/5 | Managed, but workarounds needed for state |

**Verdict:** Cloud Run's ephemeral filesystem is a fundamental mismatch with SQLite. The 60-minute WebSocket timeout is also problematic for long games. Would require architectural changes (switch to Cloud SQL, implement WebSocket reconnection with state recovery) that defeat the simplicity goal.

---

### 2.8 Heroku — Rank #9

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 4/5 | `git push heroku main`, buildpack or Dockerfile |
| WebSocket support | 3/5 | Supported, but 55-second idle timeout on free/hobby (needs heartbeat) |
| SQLite compatibility | 1/5 | Ephemeral filesystem. Dyno restarts wipe all data. |
| Cost | 2/5 | No free tier (removed 2022). Eco: $5/mo, Basic: $7/mo |
| Custom domain + SSL | 4/5 | Automatic on paid plans |
| Cold start | 2/5 | Eco dynos sleep after 30 min |
| Operational complexity | 4/5 | Managed |

**Verdict:** Heroku's ephemeral filesystem is a hard no for SQLite. The 55-second idle timeout requires aggressive WebSocket keepalive configuration. Combined with no free tier, Heroku offers nothing that Fly.io doesn't do better for this project.

---

### 2.9 Self-Hosted VPS (Raw Binary) — ⭐ Rank #3

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 3/5 | Download binary, create systemd service, set up Caddy |
| WebSocket support | 5/5 | Full native support |
| SQLite compatibility | 5/5 | Full filesystem access |
| Cost | 5/5 | Hetzner: €3.29/mo, DigitalOcean: $4/mo, Vultr: $3.50/mo |
| Custom domain + SSL | 4/5 | Caddy auto-HTTPS or Certbot |
| Cold start | 5/5 | Always running |
| Operational complexity | 2/5 | Manual OS updates, firewall management, monitoring setup |

**Verdict:** Cheapest production option. A Hetzner CX22 (2 vCPU, 4GB RAM, €3.29/mo) handles hundreds of concurrent game sessions trivially. Caddy provides automatic HTTPS with zero config. The downside is you own the server — OS updates, firewall, monitoring are your responsibility.

---

### 2.10 Vercel — Rank #10 (NOT RECOMMENDED)

| Dimension | Score | Notes |
|---|---|---|
| Ease of setup | 5/5 | Excellent for frontend |
| WebSocket support | 1/5 | **Not supported.** Vercel Edge/Serverless Functions do not support WebSockets. |
| SQLite compatibility | 1/5 | Serverless functions have ephemeral filesystem, 10-second execution limit |
| Cost | 5/5 | Generous free tier for static/serverless |
| Custom domain + SSL | 5/5 | Automatic |

**Why Vercel Won't Work:**

Vercel is a serverless/edge platform designed for request/response workloads. Traitors requires:

1. **Persistent WebSocket connections** lasting 30–90 minutes. Vercel Serverless Functions have a maximum execution time of 10 seconds (free) / 60 seconds (pro). There is no way to maintain a WebSocket connection.

2. **In-memory game state.** Each game session maintains complex state in Go memory (player roles, night actions, timers). Serverless functions are stateless by design — each invocation is a fresh process.

3. **SQLite persistence.** Vercel's filesystem is ephemeral and read-only (except `/tmp`, which is per-invocation).

4. **Server-driven timers.** The game engine runs server-side timers (phase countdowns, night action timeouts). Serverless functions cannot run background work.

**Could we split it?** Deploy the Preact SPA on Vercel and the Go API elsewhere? Technically yes, but it adds unnecessary complexity (CORS, separate deploys, URL management) and defeats the single-binary simplicity that is a core design goal.

**Verdict:** Architecturally incompatible. Do not attempt.

---

### Final Ranking

| Rank | Platform | Score | Best For |
|---|---|---|---|
| 1 | **Fly.io** | ★★★★★ | Recommended default. Best balance of simplicity, cost, and capability. |
| 2 | **Docker (self-hosted)** | ★★★★☆ | Most flexible. Works anywhere with Docker. |
| 3 | **VPS + Raw Binary** | ★★★★☆ | Cheapest production. Full control. |
| 4 | Railway | ★★★☆☆ | Good DX, but higher cost and less mature persistence. |
| 5 | Render | ★★★☆☆ | Free tier spin-down kills game sessions. |
| 6 | DO App Platform | ★★☆☆☆ | No persistent volumes for SQLite. |
| 7 | Google Cloud Run | ★★☆☆☆ | Ephemeral FS, WS timeout. |
| 8 | AWS (EC2) | ★★☆☆☆ | Over-engineered, expensive. |
| 9 | Heroku | ★☆☆☆☆ | Ephemeral FS, no free tier. |
| 10 | Vercel | ☆☆☆☆☆ | Architecturally incompatible. |

---

## 3. Top 3 Recommended Deployments

### 3.1 Option A: Fly.io (Recommended Default)

#### Prerequisites

- [Fly CLI](https://fly.io/docs/flyctl/install/) installed
- Fly.io account (free signup)

#### Step 1: Initialize

```bash
cd traitors/
fly launch --no-deploy
```

This generates a `fly.toml`. Replace its contents with:

#### Step 2: `fly.toml`

```toml
app = "traitors"
primary_region = "ams"  # Amsterdam — adjust to your region

[build]
  dockerfile = "Dockerfile"

[env]
  TRAITORS_ENV = "production"
  TRAITORS_PORT = "8080"
  TRAITORS_DB_PATH = "/data/traitors.db"
  TRAITORS_LOG_FORMAT = "json"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1     # Prevents cold starts — at least 1 machine always running
  processes = ["app"]

  [http_service.concurrency]
    type = "connections"
    hard_limit = 1000
    soft_limit = 800

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1

[mounts]
  source = "traitors_data"
  destination = "/data"
  initial_size = "1"           # 1 GB persistent volume

[checks]
  [checks.health]
    port = 8080
    type = "http"
    interval = "15s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/healthz"
```

#### Step 3: Create Volume & Deploy

```bash
# Create the persistent volume (one-time)
fly volumes create traitors_data --region ams --size 1

# Set secrets
fly secrets set TRAITORS_JWT_SECRET="$(openssl rand -base64 32)"

# Deploy
fly deploy
```

#### Step 4: Custom Domain

```bash
# Add your domain
fly certs add traitors.example.com

# Point your DNS:
# CNAME traitors.example.com → traitors.fly.dev
```

Fly automatically provisions and renews Let's Encrypt certificates.

#### Step 5: Monitor

```bash
fly logs             # Stream logs
fly status           # Machine status
fly ssh console      # SSH into the machine
fly volumes list     # Check volume health
```

#### Estimated Monthly Cost

| Resource | Cost |
|---|---|
| shared-cpu-1x, 512MB RAM | $3.19/mo |
| 1GB persistent volume | $0.15/mo |
| Outbound data (est. 5GB) | $0.00 (included) |
| **Total** | **~$3.34/mo** |

---

### 3.2 Option B: Docker on VPS (Cheapest Production)

#### Step 1: Provision a VPS

Recommended providers (cheapest tiers):

| Provider | Spec | Monthly Cost |
|---|---|---|
| **Hetzner CX22** | 2 vCPU, 4GB RAM, 40GB disk | €3.29 (~$3.50) |
| DigitalOcean Basic | 1 vCPU, 1GB RAM, 25GB disk | $4.00 |
| Vultr Cloud Compute | 1 vCPU, 1GB RAM, 25GB disk | $3.50 |
| OVH Starter VPS | 1 vCPU, 2GB RAM, 20GB disk | €3.50 |

Choose Ubuntu 24.04 LTS as the OS.

#### Step 2: Initial Server Setup

SSH into the server and run:

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Caddy (reverse proxy with auto-HTTPS)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Create app directory
mkdir -p /opt/traitors/data
```

#### Step 3: Docker Compose

Create `/opt/traitors/docker-compose.yml`:

```yaml
services:
  traitors:
    image: ghcr.io/your-org/traitors:latest
    # Or build locally:
    # build: .
    container_name: traitors
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./data:/data
    environment:
      - TRAITORS_ENV=production
      - TRAITORS_PORT=8080
      - TRAITORS_DB_PATH=/data/traitors.db
      - TRAITORS_LOG_FORMAT=json
      - TRAITORS_JWT_SECRET=${TRAITORS_JWT_SECRET}
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"

  litestream:
    image: litestream/litestream:0.3
    container_name: litestream
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./litestream.yml:/etc/litestream.yml
    command: replicate
    depends_on:
      traitors:
        condition: service_healthy
```

#### Step 4: Caddy Reverse Proxy

Create `/etc/caddy/Caddyfile`:

```caddyfile
traitors.example.com {
    reverse_proxy localhost:8080

    header {
        # Security headers
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://api.dicebear.com; connect-src 'self' wss://traitors.example.com; frame-ancestors 'none'"
    }

    encode gzip zstd

    log {
        output file /var/log/caddy/traitors.log
        format json
    }
}
```

```bash
# Reload Caddy
systemctl reload caddy
```

Caddy automatically obtains and renews Let's Encrypt certificates. No certbot, no cron jobs, no manual renewal.

#### Step 5: Start

```bash
cd /opt/traitors

# Create .env file with secrets
echo "TRAITORS_JWT_SECRET=$(openssl rand -base64 32)" > .env

# Start
docker compose up -d

# Verify
docker compose ps
docker compose logs -f traitors
curl -s http://localhost:8080/healthz
```

#### Step 6: Auto-Update (Optional)

Install Watchtower for automatic container image updates:

```bash
docker run -d \
  --name watchtower \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --cleanup \
  --interval 300 \
  traitors
```

Watchtower checks for new images every 5 minutes and auto-restarts the container.

---

### 3.3 Option C: Raw Binary on VPS (Simplest Possible)

For users who want the absolute simplest deployment: download a binary and run it.

#### Step 1: Download & Run

```bash
# Download the latest release
curl -fsSL https://github.com/your-org/traitors/releases/latest/download/traitors-linux-amd64 \
  -o /usr/local/bin/traitors
chmod +x /usr/local/bin/traitors

# Create data directory
mkdir -p /var/lib/traitors

# Run it (for testing)
TRAITORS_DB_PATH=/var/lib/traitors/traitors.db traitors
```

The binary serves everything — API, WebSocket, and embedded frontend — on port 8080.

#### Step 2: systemd Service

Create `/etc/systemd/system/traitors.service`:

```ini
[Unit]
Description=Traitors - Werewolf Game Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=traitors
Group=traitors
ExecStart=/usr/local/bin/traitors
Restart=always
RestartSec=5

# Environment
Environment=TRAITORS_ENV=production
Environment=TRAITORS_PORT=8080
Environment=TRAITORS_DB_PATH=/var/lib/traitors/traitors.db
Environment=TRAITORS_LOG_FORMAT=json
EnvironmentFile=-/etc/traitors/env

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/traitors
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
MemoryMax=512M

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=traitors

[Install]
WantedBy=multi-user.target
```

```bash
# Create service user
useradd --system --no-create-home --shell /usr/sbin/nologin traitors
chown -R traitors:traitors /var/lib/traitors

# Create secrets file
mkdir -p /etc/traitors
echo 'TRAITORS_JWT_SECRET=your-secret-here' > /etc/traitors/env
chmod 600 /etc/traitors/env

# Enable and start
systemctl daemon-reload
systemctl enable --now traitors

# Check status
systemctl status traitors
journalctl -u traitors -f
```

#### Step 3: Caddy for HTTPS

Same Caddyfile as Option B above. Caddy sits in front of the binary and handles TLS termination.

#### Step 4: Upgrade Script

Create `/usr/local/bin/traitors-upgrade`:

```bash
#!/bin/bash
set -euo pipefail

BINARY_PATH="/usr/local/bin/traitors"
BACKUP_PATH="/usr/local/bin/traitors.bak"
RELEASE_URL="https://github.com/your-org/traitors/releases/latest/download/traitors-linux-amd64"

echo "Downloading latest release..."
curl -fsSL "$RELEASE_URL" -o "${BINARY_PATH}.new"
chmod +x "${BINARY_PATH}.new"

echo "Backing up current binary..."
cp "$BINARY_PATH" "$BACKUP_PATH"

echo "Swapping binaries..."
mv "${BINARY_PATH}.new" "$BINARY_PATH"

echo "Restarting service..."
systemctl restart traitors

echo "Verifying health..."
sleep 3
if systemctl is-active --quiet traitors; then
    echo "Upgrade successful!"
    rm -f "$BACKUP_PATH"
else
    echo "Upgrade failed! Rolling back..."
    mv "$BACKUP_PATH" "$BINARY_PATH"
    systemctl restart traitors
    exit 1
fi
```

```bash
chmod +x /usr/local/bin/traitors-upgrade
```

---

## 4. Docker Strategy

### 4.1 Multi-Stage Dockerfile

```dockerfile
# ============================================================
# Stage 1: Build frontend (Preact + Vite)
# ============================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend

# Install dependencies first (layer caching)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Build the SPA
COPY frontend/ ./
RUN npm run build
# Output: /build/frontend/dist/

# ============================================================
# Stage 2: Build Go binary
# ============================================================
FROM golang:1.23-alpine AS go-builder

RUN apk add --no-cache gcc musl-dev
# gcc + musl-dev required for CGO (SQLite via go-sqlite3)

WORKDIR /build

# Download Go dependencies first (layer caching)
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Copy built frontend into embed directory
COPY --from=frontend-builder /build/frontend/dist/ ./internal/web/dist/

# Build with CGO enabled (required for SQLite)
RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-s -w -X main.version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -trimpath \
    -o /traitors \
    ./cmd/traitors

# ============================================================
# Stage 3: Minimal runtime image
# ============================================================
FROM alpine:3.20

# Install ca-certificates (for HTTPS calls) and tzdata
RUN apk add --no-cache ca-certificates tzdata wget

# Create non-root user
RUN addgroup -g 1000 -S traitors && \
    adduser -u 1000 -S traitors -G traitors

# Create data directory
RUN mkdir -p /data && chown traitors:traitors /data

# Copy binary
COPY --from=go-builder /traitors /usr/local/bin/traitors

# Switch to non-root user
USER traitors

# Default environment
ENV TRAITORS_PORT=8080
ENV TRAITORS_DB_PATH=/data/traitors.db
ENV TRAITORS_LOG_FORMAT=json

EXPOSE 8080

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

ENTRYPOINT ["traitors"]
```

### 4.2 Image Size Optimization

| Stage | Image Size | Notes |
|---|---|---|
| `node:22-alpine` (build) | ~180MB | Discarded after build |
| `golang:1.23-alpine` (build) | ~250MB | Discarded after build |
| `alpine:3.20` (runtime) | ~7MB | Base runtime |
| **Final image** | **~15–25MB** | Binary + ca-certs + tzdata |

Optimization techniques used:
- **Alpine base** for minimal image size.
- **Multi-stage builds** — build tools never appear in the final image.
- **`-ldflags="-s -w"`** strips debug symbols and DWARF info from the binary (~30% size reduction).
- **`-trimpath`** removes build paths from the binary for reproducibility.
- **Layer caching** — `COPY go.mod go.sum` and `RUN go mod download` are separate from `COPY . .` so dependency downloads are cached unless `go.mod` changes.

### 4.3 `.dockerignore`

```
.git
.github
.vscode
*.md
LICENSE
docs/
frontend/node_modules/
**/*_test.go
```

### 4.4 docker-compose for Local Development

```yaml
# docker-compose.dev.yml
services:
  traitors:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: traitors-dev
    ports:
      - "8080:8080"
    volumes:
      - traitors-data:/data
    environment:
      - TRAITORS_ENV=development
      - TRAITORS_PORT=8080
      - TRAITORS_DB_PATH=/data/traitors.db
      - TRAITORS_LOG_FORMAT=text
      - TRAITORS_LOG_LEVEL=debug
      - TRAITORS_JWT_SECRET=dev-secret-do-not-use-in-production
      - TRAITORS_CORS_ORIGINS=http://localhost:5173
    restart: unless-stopped

  # Frontend dev server (hot reload)
  frontend:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./frontend:/app
      - frontend-node-modules:/app/node_modules
    ports:
      - "5173:5173"
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
    environment:
      - VITE_API_URL=http://localhost:8080
      - VITE_WS_URL=ws://localhost:8080

volumes:
  traitors-data:
  frontend-node-modules:
```

Usage:

```bash
# Start everything
docker compose -f docker-compose.dev.yml up

# Rebuild after Go changes
docker compose -f docker-compose.dev.yml up --build traitors

# View logs
docker compose -f docker-compose.dev.yml logs -f traitors
```

---

## 5. CI/CD Pipeline

### 5.1 GitHub Actions — Main Workflow

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
    branches: [main]

permissions:
  contents: write
  packages: write

env:
  GO_VERSION: "1.23"
  NODE_VERSION: "22"
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ─────────────────────────────────────────────
  # Lint & Format
  # ─────────────────────────────────────────────
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}

      - name: Go vet
        run: go vet ./...

      - name: golangci-lint
        uses: golangci/golangci-lint-action@v6
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Frontend lint
        working-directory: frontend
        run: |
          npm ci
          npm run lint
          npm run typecheck

  # ─────────────────────────────────────────────
  # Test
  # ─────────────────────────────────────────────
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}

      - name: Go tests
        run: |
          go test -v -race -coverprofile=coverage.out ./...
          go tool cover -func=coverage.out

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Frontend tests
        working-directory: frontend
        run: |
          npm ci
          npm run test -- --coverage

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: |
            coverage.out
            frontend/coverage/

  # ─────────────────────────────────────────────
  # Build & Push Docker Image
  # ─────────────────────────────────────────────
  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # For git describe

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha

      - uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64

  # ─────────────────────────────────────────────
  # Build Release Binaries
  # ─────────────────────────────────────────────
  release-binaries:
    name: Release Binaries
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    needs: [lint, test]
    strategy:
      matrix:
        include:
          - goos: linux
            goarch: amd64
          - goos: linux
            goarch: arm64
          - goos: darwin
            goarch: amd64
          - goos: darwin
            goarch: arm64
          - goos: windows
            goarch: amd64
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: ${{ env.GO_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Build frontend
        working-directory: frontend
        run: |
          npm ci
          npm run build

      - name: Copy frontend dist
        run: cp -r frontend/dist/ internal/web/dist/

      - name: Build binary
        env:
          GOOS: ${{ matrix.goos }}
          GOARCH: ${{ matrix.goarch }}
          CGO_ENABLED: ${{ matrix.goos == 'linux' && '1' || '0' }}
        run: |
          BINARY_NAME="traitors-${{ matrix.goos }}-${{ matrix.goarch }}"
          if [ "${{ matrix.goos }}" = "windows" ]; then
            BINARY_NAME="${BINARY_NAME}.exe"
          fi
          go build \
            -ldflags="-s -w -X main.version=${{ github.ref_name }}" \
            -trimpath \
            -o "dist/${BINARY_NAME}" \
            ./cmd/traitors

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: binary-${{ matrix.goos }}-${{ matrix.goarch }}
          path: dist/

  # ─────────────────────────────────────────────
  # Create GitHub Release
  # ─────────────────────────────────────────────
  release:
    name: Create Release
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    needs: [build, release-binaries]
    steps:
      - uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts/
          pattern: binary-*
          merge-multiple: true

      - name: Create checksums
        run: |
          cd artifacts
          sha256sum traitors-* > checksums.txt

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            artifacts/traitors-*
            artifacts/checksums.txt

  # ─────────────────────────────────────────────
  # Deploy to Fly.io (on merge to main)
  # ─────────────────────────────────────────────
  deploy-fly:
    name: Deploy to Fly.io
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    needs: [build]
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy
        run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 5.2 Release Strategy — Semantic Versioning

```
Tags:      v1.0.0, v1.0.1, v1.1.0, v2.0.0
Branches:  main (production), develop (next release)
```

**Release process:**

```bash
# 1. Update version in code (if tracked)
# 2. Tag and push
git tag -a v1.2.0 -m "Release v1.2.0: Add Witch role"
git push origin v1.2.0
```

This triggers:
1. Lint + test
2. Build Docker image tagged with `v1.2.0`, `v1.2`, `v1`, `latest`
3. Build binaries for linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64
4. Create GitHub Release with binaries and auto-generated changelog
5. Deploy to Fly.io

### 5.3 Dependabot

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: gomod
    directory: "/"
    schedule:
      interval: weekly
    reviewers:
      - "your-username"

  - package-ecosystem: npm
    directory: "/frontend"
    schedule:
      interval: weekly
    reviewers:
      - "your-username"

  - package-ecosystem: docker
    directory: "/"
    schedule:
      interval: weekly

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
```

---

## 6. Configuration Management

### 6.1 Environment Variables — Complete Reference

All configuration is via environment variables. No config files required for basic setup.

| Variable | Default | Description |
|---|---|---|
| `TRAITORS_ENV` | `development` | Environment: `development`, `production`, `test` |
| `TRAITORS_PORT` | `8080` | HTTP server port |
| `TRAITORS_HOST` | `0.0.0.0` | Bind address |
| `TRAITORS_DB_PATH` | `./traitors.db` | Path to SQLite database file |
| `TRAITORS_LOG_FORMAT` | `text` | Log format: `text` (human-readable) or `json` (structured) |
| `TRAITORS_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `TRAITORS_JWT_SECRET` | (auto-generated) | JWT signing key. **Must be set in production.** |
| `TRAITORS_JWT_EXPIRY` | `24h` | JWT token expiry duration |
| `TRAITORS_CORS_ORIGINS` | `*` (dev), none (prod) | Allowed CORS origins (comma-separated) |
| `TRAITORS_MAX_ROOMS` | `100` | Maximum concurrent game rooms |
| `TRAITORS_MAX_PLAYERS_PER_ROOM` | `20` | Maximum players per room |
| `TRAITORS_ROOM_IDLE_TIMEOUT` | `2h` | Auto-cleanup idle rooms after this duration |
| `TRAITORS_WS_PING_INTERVAL` | `15s` | WebSocket heartbeat ping interval |
| `TRAITORS_WS_PONG_TIMEOUT` | `10s` | WebSocket pong response deadline |
| `TRAITORS_WS_WRITE_TIMEOUT` | `10s` | WebSocket write deadline |
| `TRAITORS_RATE_LIMIT_RPS` | `20` | HTTP requests per second per IP |
| `TRAITORS_RATE_LIMIT_BURST` | `40` | HTTP burst allowance per IP |
| `TRAITORS_METRICS_ENABLED` | `false` | Enable Prometheus metrics at `/metrics` |
| `TRAITORS_BASE_URL` | (auto-detect) | Public base URL for game links |

### 6.2 Zero-Config Startup

The application must start with **zero configuration**:

```bash
# This must work:
./traitors

# What happens:
# - Listens on :8080
# - Creates traitors.db in current directory
# - Generates a random JWT secret (logs a warning about production use)
# - Serves the embedded SPA at /
# - API at /api/*
# - WebSocket at /ws
# - Health check at /healthz
```

Default behavior on first run:
1. If `TRAITORS_JWT_SECRET` is not set, generate a random one and log: `WARN: JWT secret auto-generated. Set TRAITORS_JWT_SECRET for production use.`
2. If `TRAITORS_DB_PATH` does not exist, create the database and run migrations automatically.
3. If `TRAITORS_ENV=development`, enable verbose logging and permissive CORS.

### 6.3 Secrets Management

| Secret | How to Set | Notes |
|---|---|---|
| `TRAITORS_JWT_SECRET` | `fly secrets set` / `.env` file / systemd `EnvironmentFile` | Minimum 32 bytes, base64-encoded recommended |

**Generation:**

```bash
# Generate a secure JWT secret
openssl rand -base64 32
# Example output: K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
```

**Per-platform:**

| Platform | How |
|---|---|
| Fly.io | `fly secrets set TRAITORS_JWT_SECRET="..."` |
| Docker | `.env` file (chmod 600) or Docker secrets |
| systemd | `/etc/traitors/env` file (chmod 600, owned by root) |
| Railway | Dashboard → Variables |
| GitHub Actions | Repository secrets |

---

## 7. Monitoring & Observability

### 7.1 Health Check Endpoint

```
GET /healthz
```

Response (healthy):

```json
{
  "status": "ok",
  "version": "1.2.0",
  "uptime": "48h32m15s",
  "db": "ok",
  "active_rooms": 12,
  "active_connections": 87,
  "timestamp": "2026-04-25T20:15:00Z"
}
```

Response (unhealthy):

```json
{
  "status": "error",
  "version": "1.2.0",
  "uptime": "48h32m15s",
  "db": "error: database is locked",
  "active_rooms": 0,
  "active_connections": 0,
  "timestamp": "2026-04-25T20:15:00Z"
}
```

HTTP status codes:
- `200 OK` — healthy
- `503 Service Unavailable` — unhealthy (DB error, etc.)

### 7.2 Readiness Endpoint

```
GET /readyz
```

Returns `200` only when the server is fully initialized and ready to accept connections. Used by Fly.io/k8s for readiness probes.

### 7.3 Structured JSON Logging

When `TRAITORS_LOG_FORMAT=json`:

```json
{"level":"info","ts":"2026-04-25T20:15:00.123Z","msg":"server started","port":8080,"version":"1.2.0"}
{"level":"info","ts":"2026-04-25T20:15:01.456Z","msg":"room created","room_id":"XK7M2Q","moderator":"player_abc"}
{"level":"info","ts":"2026-04-25T20:15:02.789Z","msg":"player joined","room_id":"XK7M2Q","player_id":"player_def","player_name":"Ali","player_count":5}
{"level":"info","ts":"2026-04-25T20:15:10.000Z","msg":"game started","room_id":"XK7M2Q","player_count":8,"roles":["werewolf","werewolf","seer","doctor","villager","villager","villager","villager"]}
{"level":"info","ts":"2026-04-25T20:16:00.000Z","msg":"phase changed","room_id":"XK7M2Q","phase":"night","round":1}
{"level":"warn","ts":"2026-04-25T20:20:00.000Z","msg":"player disconnected","room_id":"XK7M2Q","player_id":"player_ghi","reason":"websocket close"}
{"level":"info","ts":"2026-04-25T20:45:00.000Z","msg":"game ended","room_id":"XK7M2Q","winner":"village","rounds":4,"duration":"30m00s"}
{"level":"info","ts":"2026-04-25T22:15:00.000Z","msg":"room cleaned up","room_id":"XK7M2Q","reason":"idle_timeout"}
```

Recommended Go logging library: `log/slog` (standard library, zero dependencies).

```go
// Example slog setup
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))
slog.SetDefault(logger)

// Usage
slog.Info("player joined",
    "room_id", room.ID,
    "player_id", player.ID,
    "player_name", player.Name,
    "player_count", len(room.Players),
)
```

### 7.4 Prometheus Metrics

When `TRAITORS_METRICS_ENABLED=true`, expose metrics at `GET /metrics`:

```
# HELP traitors_active_rooms Number of currently active game rooms
# TYPE traitors_active_rooms gauge
traitors_active_rooms 12

# HELP traitors_active_connections Number of active WebSocket connections
# TYPE traitors_active_connections gauge
traitors_active_connections 87

# HELP traitors_games_total Total number of games completed
# TYPE traitors_games_total counter
traitors_games_total{winner="village"} 156
traitors_games_total{winner="werewolf"} 132
traitors_games_total{winner="tanner"} 8
traitors_games_total{winner="draw"} 3

# HELP traitors_game_duration_seconds Duration of completed games
# TYPE traitors_game_duration_seconds histogram
traitors_game_duration_seconds_bucket{le="300"} 12
traitors_game_duration_seconds_bucket{le="600"} 45
traitors_game_duration_seconds_bucket{le="1200"} 120
traitors_game_duration_seconds_bucket{le="1800"} 180
traitors_game_duration_seconds_bucket{le="3600"} 195
traitors_game_duration_seconds_bucket{le="+Inf"} 199

# HELP traitors_http_requests_total Total HTTP requests
# TYPE traitors_http_requests_total counter
traitors_http_requests_total{method="GET",path="/healthz",status="200"} 4521

# HELP traitors_ws_messages_total Total WebSocket messages processed
# TYPE traitors_ws_messages_total counter
traitors_ws_messages_total{direction="in"} 125000
traitors_ws_messages_total{direction="out"} 890000

# HELP traitors_db_size_bytes SQLite database file size in bytes
# TYPE traitors_db_size_bytes gauge
traitors_db_size_bytes 4194304
```

### 7.5 Uptime Monitoring

For external uptime monitoring (free options):

| Service | Free Tier | Setup |
|---|---|---|
| **UptimeRobot** | 50 monitors, 5-min checks | Monitor `https://traitors.example.com/healthz` |
| **Betterstack (Better Uptime)** | 10 monitors, 3-min checks | Same URL, alerts via email/Slack |
| **Fly.io built-in** | Included | Health checks defined in `fly.toml` |

UptimeRobot setup:

1. Create account at uptimerobot.com
2. Add monitor: HTTP(S), URL = `https://traitors.example.com/healthz`
3. Keyword monitoring: expect `"status":"ok"` in response body
4. Alert contacts: email + optional Slack webhook

---

## 8. Security

### 8.1 TLS/SSL Termination Strategy

```
Internet → Caddy/Fly.io (TLS termination) → Go binary (HTTP)
```

The Go binary **does not handle TLS directly**. TLS is terminated at the reverse proxy layer:

| Deployment | TLS Provider |
|---|---|
| Fly.io | Fly's edge proxy (automatic Let's Encrypt) |
| VPS + Docker | Caddy (automatic Let's Encrypt) |
| VPS + raw binary | Caddy (automatic Let's Encrypt) |
| Cloudflare | Cloudflare edge (Full Strict mode + origin cert) |

**Why not terminate TLS in Go?** Adds complexity (cert management, renewal) that reverse proxies solve better. Caddy in particular handles OCSP stapling, HTTP/2, and cert renewal with zero configuration.

### 8.2 Rate Limiting

Implement token-bucket rate limiting per IP address in the Go HTTP middleware:

```go
// Recommended: golang.org/x/time/rate

var limiter = rate.NewLimiter(rate.Limit(20), 40) // 20 req/s, burst of 40

func rateLimitMiddleware(next http.Handler) http.Handler {
    // Per-IP limiters stored in sync.Map with periodic cleanup
}
```

| Endpoint | Rate Limit | Notes |
|---|---|---|
| `POST /api/rooms` | 5/min per IP | Prevent room flooding |
| `POST /api/rooms/:id/join` | 10/min per IP | Prevent join spam |
| `GET /*` (static) | 100/s per IP | Generous for SPA assets |
| WebSocket messages | 30/s per connection | Prevent message flooding |
| `/healthz`, `/metrics` | Exempt | Monitoring must not be rate-limited |

### 8.3 CORS Configuration

```go
func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")

        if isAllowedOrigin(origin) {
            w.Header().Set("Access-Control-Allow-Origin", origin)
            w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
            w.Header().Set("Access-Control-Allow-Credentials", "true")
            w.Header().Set("Access-Control-Max-Age", "86400")
        }

        if r.Method == "OPTIONS" {
            w.WriteHeader(http.StatusNoContent)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

| Environment | Allowed Origins |
|---|---|
| Development | `http://localhost:5173`, `http://localhost:8080` |
| Production (embedded SPA) | Same-origin only (no CORS needed) |
| Production (split deploy) | `https://traitors.example.com` only |

Since the SPA is embedded in the Go binary (same origin), CORS is only needed in development when the Vite dev server runs on a different port.

### 8.4 Content Security Policy

Set via Caddy headers (see Caddyfile above) or Go middleware:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://api.dicebear.com;
  connect-src 'self' wss://traitors.example.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

Notes:
- `'unsafe-inline'` for styles is required by Tailwind's generated CSS. Could be replaced with hash-based CSP if build tooling supports it.
- `wss://` for WebSocket connections to self.
- `https://api.dicebear.com` for avatar generation.
- `frame-ancestors 'none'` prevents clickjacking.

### 8.5 WebSocket Origin Validation

```go
var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        origin := r.Header.Get("Origin")
        if os.Getenv("TRAITORS_ENV") == "development" {
            return true
        }
        return origin == "" || isAllowedOrigin(origin)
    },
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
}
```

In production, only accept WebSocket connections from the application's own origin. This prevents cross-site WebSocket hijacking.

### 8.6 Additional Security Headers

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### 8.7 Input Validation

All inputs validated server-side. Never trust the client.

| Input | Validation |
|---|---|
| Player name | 1–30 chars, trimmed, no HTML, no control chars |
| Game code | Exactly 6 uppercase alphanumeric chars |
| Chat messages | 1–500 chars, trimmed, rate-limited |
| Night action targets | Must be a valid living player ID in the current game |
| Vote targets | Must be a valid nominee ID |
| Room configuration | All values within defined min/max ranges (§8.2 in GAME_LOGIC.md) |

---

## 9. One-Click Deploy Options

### 9.1 Deploy to Fly.io Button

Add to `README.md`:

```markdown
[![Deploy on Fly.io](https://fly.io/button/button-sm.svg)](https://fly.io/launch?repo=https://github.com/your-org/traitors)
```

This requires a `fly.toml` in the repo root (already provided in §3.1).

What happens when clicked:
1. User is directed to Fly.io signup/login.
2. Fly clones the repo.
3. Fly detects the Dockerfile and `fly.toml`.
4. User chooses a region and app name.
5. Fly builds and deploys.
6. User receives a `https://app-name.fly.dev` URL.

### 9.2 Deploy to Railway Button

Add to `README.md`:

```markdown
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template?repo=https://github.com/your-org/traitors)
```

Requires a `railway.toml` in the repo root:

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/healthz"
healthcheckTimeout = 30
restartPolicyType = "always"

[[services]]
name = "traitors"
internalPort = 8080
```

### 9.3 docker-compose One-Liner

```markdown
## Quick Start with Docker

```bash
curl -fsSL https://raw.githubusercontent.com/your-org/traitors/main/docker-compose.yml -o docker-compose.yml && docker compose up -d
```
```

### 9.4 "Download Binary, Run It"

The simplest possible deployment:

```markdown
## Quick Start (No Docker Required)

### Linux (x86_64)
```bash
curl -fsSL https://github.com/your-org/traitors/releases/latest/download/traitors-linux-amd64 -o traitors
chmod +x traitors
./traitors
```

### macOS (Apple Silicon)
```bash
curl -fsSL https://github.com/your-org/traitors/releases/latest/download/traitors-darwin-arm64 -o traitors
chmod +x traitors
./traitors
```

Open http://localhost:8080 in your browser. That's it.
```

This works because:
- The Go binary embeds the compiled SPA (via `embed.FS`).
- SQLite creates the database file automatically.
- A JWT secret is auto-generated for development use.
- All defaults are sensible for local play.

For production, the user just needs to add a reverse proxy (Caddy) for HTTPS and set `TRAITORS_JWT_SECRET`.

---

## 10. Cost Analysis

### 10.1 Free Tier Options

| Platform | What's Free | Limitations |
|---|---|---|
| **Fly.io** | 3 shared-cpu VMs, 160GB bandwidth | Volume: $0.15/GB/mo. Free machines may be stopped if account has no payment method. |
| **Oracle Cloud** | 4 ARM Ampere cores, 24GB RAM (always free) | Complex setup, less ergonomic than Fly. Best free tier in existence. |
| **GitHub Actions** | 2000 min/month CI (free for public repos) | Unlimited for public repos |
| **UptimeRobot** | 50 monitors | 5-min check interval |
| **Cloudflare** | DNS + CDN + DDoS protection | Free plan is very generous |

**Cheapest "free" production setup:**

```
Fly.io (free tier, 1 machine)  = $0.00*
Cloudflare DNS + proxy          = $0.00
UptimeRobot monitoring          = $0.00
GitHub Actions CI               = $0.00
───────────────────────────────────────
Total                           = $0.00/mo

* Requires a payment method on file. Fly may stop free machines under heavy account usage.
```

### 10.2 Cheapest Reliable Production Setup

```
Hetzner CX22 VPS (2 vCPU, 4GB)  = €3.29/mo (~$3.50)
Docker + Caddy (on VPS)           = $0.00
Cloudflare DNS                    = $0.00
Litestream → Cloudflare R2       = $0.00 (10GB free storage)
UptimeRobot                       = $0.00
───────────────────────────────────────
Total                             = ~$3.50/mo
```

### 10.3 Recommended Production Setup

```
Fly.io (shared-cpu-1x, 512MB)    = $3.19/mo
Fly Volume (1GB)                  = $0.15/mo
Cloudflare DNS + proxy            = $0.00
Litestream → Fly Volume backup    = $0.00
UptimeRobot                       = $0.00
GitHub Actions                    = $0.00
───────────────────────────────────────
Total                             = ~$3.34/mo
```

### 10.4 Scaling Costs

The application is single-server by design. Scaling means getting a bigger server, not more servers.

| Load | Fly.io Config | Est. Cost |
|---|---|---|
| < 50 concurrent sessions | shared-cpu-1x, 512MB | $3.34/mo |
| 50–200 concurrent sessions | shared-cpu-2x, 1GB | $6.38/mo |
| 200–500 concurrent sessions | performance-1x, 2GB | $29/mo |
| 500+ concurrent sessions | performance-2x, 4GB | $58/mo |

Each game session uses approximately:
- ~50KB memory for game state
- ~10 WebSocket connections (8 players + moderator + spectators)
- ~1KB/s bandwidth during active play

500 concurrent sessions ≈ 25MB game state + 5000 WebSocket connections ≈ easily fits in 2GB RAM with Go's efficient concurrency model.

---

## 11. Domain & SSL

### 11.1 Recommended DNS Setup: Cloudflare

Even if not using Cloudflare as a CDN/proxy, their free DNS is fast and reliable.

```
# DNS Records (Cloudflare dashboard or API)

# For Fly.io:
traitors.example.com    CNAME   traitors.fly.dev         (Proxied: OFF)

# For VPS:
traitors.example.com    A       203.0.113.42             (Proxied: ON or OFF)

# For Cloudflare proxy (recommended for VPS):
traitors.example.com    A       203.0.113.42             (Proxied: ON)
```

### 11.2 Cloudflare as CDN/Proxy

If using Cloudflare proxy (orange cloud ON):

**SSL/TLS settings:**

| Setting | Value | Why |
|---|---|---|
| SSL mode | Full (Strict) | End-to-end encryption. Caddy provides the origin cert. |
| Always Use HTTPS | ON | Redirect HTTP → HTTPS at the edge |
| Minimum TLS Version | TLS 1.2 | Security baseline |
| HTTP/2 | ON | Performance |
| WebSocket | ON | **Required.** Enable in Network settings. |

**Important: WebSocket through Cloudflare.** Cloudflare proxies WebSocket connections on all plans (including free). Enable WebSockets in the Cloudflare dashboard under Network → WebSockets. The connection is proxied transparently.

**Cloudflare-specific settings:**

```
# Page Rules or Configuration Rules
traitors.example.com/ws*
  → WebSocket: ON (should be default)
  → Cache Level: Bypass (don't cache WS upgrades)

traitors.example.com/assets/*
  → Cache Level: Cache Everything
  → Edge Cache TTL: 1 month
```

### 11.3 Let's Encrypt Automation (VPS)

If using Caddy (recommended), Let's Encrypt is fully automatic. Zero configuration beyond the domain name in the Caddyfile.

If using nginx instead of Caddy:

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Obtain certificate
certbot --nginx -d traitors.example.com

# Auto-renewal is set up automatically via systemd timer
systemctl status certbot.timer
```

### 11.4 Custom Domain Steps (Complete)

**For Fly.io:**

```bash
# 1. Add certificate
fly certs add traitors.example.com

# 2. Get the verification records
fly certs show traitors.example.com
# → Add the shown CNAME record to your DNS

# 3. Add DNS record
# CNAME traitors.example.com → traitors.fly.dev

# 4. Verify (may take a few minutes)
fly certs check traitors.example.com
```

**For VPS:**

```bash
# 1. Point DNS A record to your VPS IP
# A traitors.example.com → 203.0.113.42

# 2. Configure Caddy (already done in §3.2 Step 4)
# The Caddyfile already has the domain

# 3. Reload Caddy
systemctl reload caddy
# Caddy automatically obtains the cert on first request
```

---

## 12. Backup & Recovery

### 12.1 SQLite Backup Strategy

SQLite is a single file, which makes backups simple. But a naive `cp` during writes can produce a corrupt copy. Use proper backup methods.

#### Method 1: Litestream (Recommended — Continuous Replication)

[Litestream](https://litestream.io/) continuously replicates SQLite changes to S3-compatible storage. Near-zero RPO (recovery point objective).

**`litestream.yml`:**

```yaml
dbs:
  - path: /data/traitors.db
    replicas:
      # Option A: Cloudflare R2 (10GB free)
      - type: s3
        bucket: traitors-backups
        path: replica
        endpoint: https://<account-id>.r2.cloudflarestorage.com
        access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
        retention: 720h          # 30 days
        retention-check-interval: 1h
        sync-interval: 1s

      # Option B: Local directory (for VPS)
      # - type: file
      #   path: /backups/traitors
      #   retention: 720h
```

**Running Litestream with Docker:**

Already included in the `docker-compose.yml` in §3.2 as a sidecar container.

**Running Litestream with raw binary:**

```bash
# Install Litestream
curl -fsSL https://github.com/benbjohnson/litestream/releases/latest/download/litestream-linux-amd64.deb -o litestream.deb
dpkg -i litestream.deb

# Start replication (runs in background)
litestream replicate -config /etc/litestream.yml
```

**Restore from backup:**

```bash
# List available backups
litestream snapshots -config /etc/litestream.yml /data/traitors.db

# Restore to a specific point in time
litestream restore -config /etc/litestream.yml -timestamp "2026-04-25T20:00:00Z" /data/traitors.db

# Restore latest
litestream restore -config /etc/litestream.yml /data/traitors.db
```

#### Method 2: SQLite Online Backup API (Periodic Snapshots)

For simpler setups without Litestream, use SQLite's built-in backup via a scheduled task:

```bash
#!/bin/bash
# /usr/local/bin/traitors-backup
set -euo pipefail

DB_PATH="/var/lib/traitors/traitors.db"
BACKUP_DIR="/var/lib/traitors/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Use SQLite's .backup command (safe during writes)
sqlite3 "$DB_PATH" ".backup '${BACKUP_DIR}/traitors_${TIMESTAMP}.db'"

# Compress
gzip "${BACKUP_DIR}/traitors_${TIMESTAMP}.db"

# Retain last 30 days
find "$BACKUP_DIR" -name "*.db.gz" -mtime +30 -delete

echo "Backup complete: traitors_${TIMESTAMP}.db.gz"
```

```bash
# Add to crontab (every 6 hours)
echo "0 */6 * * * /usr/local/bin/traitors-backup" | crontab -
```

### 12.2 Disaster Recovery Plan

| Scenario | RTO | RPO | Recovery Steps |
|---|---|---|---|
| **Application crash** | 5s | 0 | systemd/Docker auto-restart. Game state in memory is lost; clients reconnect and get last persisted state. |
| **Database corruption** | 5min | 1s (Litestream) / 6h (periodic) | Stop server, restore from Litestream/backup, restart. |
| **VPS disk failure** | 30min | 1s (Litestream) | Provision new VPS, install Docker/binary, restore DB from Litestream, update DNS. |
| **Region outage (Fly.io)** | 15min | 1s | `fly volumes fork` to a different region, `fly deploy --region <new>`. |
| **Accidental deletion** | 10min | 1s (Litestream) | Restore from Litestream to any point in time. |

**Recovery runbook (VPS total loss):**

```bash
# 1. Provision new VPS (Hetzner, DigitalOcean, etc.)

# 2. Run initial setup (from §3.2 Step 2)
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
# ... (install Caddy, create directories)

# 3. Restore database from Litestream
litestream restore -config /etc/litestream.yml /opt/traitors/data/traitors.db

# 4. Start the application
cd /opt/traitors && docker compose up -d

# 5. Update DNS to point to new server IP
# (Cloudflare dashboard or API)

# 6. Verify
curl https://traitors.example.com/healthz
```

### 12.3 Data Retention Policy

| Data Type | Retention | Storage |
|---|---|---|
| Active game state | In-memory during game; persisted to DB on key events | RAM + SQLite |
| Completed game records | 90 days | SQLite |
| Player sessions | 24 hours after last activity | SQLite |
| Chat messages | Duration of game only (not persisted after game ends) | In-memory |
| Litestream replicas | 30 days | S3-compatible storage |
| Periodic backups | 30 days | Local disk or S3 |

**Automatic cleanup** (run as a background goroutine or cron):

```sql
-- Delete completed games older than 90 days
DELETE FROM games WHERE status = 'completed' AND ended_at < datetime('now', '-90 days');

-- Delete orphaned player sessions
DELETE FROM sessions WHERE last_active < datetime('now', '-24 hours');

-- Vacuum to reclaim space
VACUUM;
```

---

## Appendix A: Quick Reference — Command Cheat Sheet

### Fly.io

```bash
fly launch                        # Initialize app
fly deploy                        # Deploy
fly logs                          # Stream logs
fly status                        # Machine status
fly ssh console                   # SSH into machine
fly secrets set KEY=value         # Set secret
fly volumes list                  # List volumes
fly certs add domain.com          # Add custom domain
fly scale count 1                 # Scale to 1 machine
fly monitor                       # Real-time dashboard
```

### Docker

```bash
docker compose up -d              # Start in background
docker compose down               # Stop
docker compose logs -f traitors   # Follow logs
docker compose ps                 # Show status
docker compose pull               # Pull latest image
docker compose up -d --force-recreate  # Restart with new image
docker exec -it traitors sh       # Shell into container
```

### systemd (Raw Binary)

```bash
systemctl start traitors          # Start
systemctl stop traitors           # Stop
systemctl restart traitors        # Restart
systemctl status traitors         # Status
journalctl -u traitors -f         # Follow logs
journalctl -u traitors --since "1 hour ago"  # Recent logs
```

### Database

```bash
# Backup (safe during writes)
sqlite3 /data/traitors.db ".backup /tmp/backup.db"

# Check integrity
sqlite3 /data/traitors.db "PRAGMA integrity_check;"

# Database size
sqlite3 /data/traitors.db "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();"

# Active connections (from app metrics)
curl -s http://localhost:8080/healthz | jq .active_connections
```

---

## Appendix B: Architecture Decision Records

### ADR-001: SQLite over PostgreSQL

**Decision:** Use SQLite for persistence.

**Context:** The application is single-server, single-process. Game state is primarily in-memory during active games. The database stores room configuration, completed game records, and player sessions.

**Rationale:**
- Zero operational complexity (no database server to manage).
- Embedded in the Go binary (via `go-sqlite3` or `modernc.org/sqlite`).
- Single-file database simplifies backups (Litestream for continuous replication).
- More than sufficient for the write load (game events are infrequent relative to in-memory operations).
- Eliminates a network hop for every query.

**Trade-off:** Cannot horizontally scale the database. Acceptable because the application is designed for single-server deployment.

**Alternative considered:** `modernc.org/sqlite` (pure Go, no CGO). Eliminates the need for `gcc` in the build container but is ~30% slower for write-heavy workloads. Acceptable for this application's load profile. Switch to modernc if CGO causes cross-compilation pain.

### ADR-002: Caddy over nginx for Reverse Proxy

**Decision:** Recommend Caddy as the default reverse proxy.

**Context:** Need automatic HTTPS with minimal configuration for self-hosted deployments.

**Rationale:**
- Automatic HTTPS via Let's Encrypt with zero configuration.
- Automatic HTTP → HTTPS redirect.
- Automatic OCSP stapling.
- Automatic HTTP/2.
- Caddyfile syntax is dramatically simpler than nginx config.
- WebSocket proxying works without special configuration.
- Automatic cert renewal (no crontab, no certbot).

**Trade-off:** nginx has broader community knowledge and slightly better raw performance at extreme scale. Neither matters for this application.

### ADR-003: Fly.io as Default Recommendation

**Decision:** Recommend Fly.io as the primary deployment platform.

**Context:** Need a platform that supports WebSockets, persistent volumes (for SQLite), custom domains, and automatic TLS — with minimal DevOps knowledge required.

**Rationale:**
- Purpose-built for long-running processes (not serverless).
- Persistent volumes for SQLite.
- Native WebSocket support with no connection timeouts.
- `fly.toml` + Dockerfile = fully reproducible deployment.
- Cheapest managed platform for this use case (~$3.34/mo).
- `fly deploy` from CI is a single command.
- Built-in health checks, metrics, and log aggregation.

**Trade-off:** Vendor lock-in to Fly's platform abstractions. Mitigated by the Dockerfile — the same image runs anywhere Docker runs.
