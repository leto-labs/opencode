# Running OpenCode as a Headless Server

This guide covers deploying opencode as an always-on headless server on a Linux VM, exposed publicly with password authentication and managed via systemd.

## Overview

OpenCode has a built-in `serve` command that starts a headless HTTP server. The web UI is served by proxying to `app.opencode.ai`, so the server exposes both the API and the webapp. The server supports:

- HTTP Basic Auth via environment variables
- Configurable port and hostname binding
- SSE event streaming and WebSocket connections
- Full REST API with OpenAPI docs at `/doc`

## Prerequisites

- A Linux VM with a public IP (or behind a reverse proxy)
- OpenCode binary installed (see [Installation](#1-install-opencode))
- AI provider credentials — either already configured through OpenCode (stored on disk) or available as environment variables

## Quick Start

```bash
# Generate a strong password
openssl rand -base64 32

# Set the server password (required for public exposure)
export OPENCODE_SERVER_PASSWORD="your-strong-password"

# Start the server on all interfaces, port 4096
opencode serve --hostname 0.0.0.0 --port 4096
```

Then open `http://<your-vm-ip>:4096` in a browser. You'll be prompted for HTTP Basic Auth credentials (username: `opencode`, password: the value you set).

## Step-by-Step Setup

### 1. Install OpenCode

#### Option A: From a release

Download the latest release binary for your architecture:

```bash
# Example for Linux x64
curl -fsSL https://github.com/anthropics/opencode/releases/latest/download/opencode-linux-x64 -o /usr/local/bin/opencode
chmod +x /usr/local/bin/opencode
opencode --version
```

#### Option B: Build from a custom fork

The build produces a self-contained native binary (no runtime dependencies). It requires [Bun](https://bun.sh) >= 1.3.5.

```bash
# Install Bun if not present
curl -fsSL https://bun.sh/install | bash

# Clone your fork
git clone https://github.com/<your-org>/opencode.git
cd opencode

# Install workspace dependencies (monorepo root)
bun install

# Build a single binary for the current platform
cd packages/opencode
bun run build -- --single

# The binary is at dist/opencode-linux-x64/bin/opencode (name varies by platform)
# Copy it to a location on PATH
sudo cp dist/opencode-linux-*/bin/opencode /usr/local/bin/opencode
sudo chmod +x /usr/local/bin/opencode
opencode --version
```

The `--single` flag builds only for the current OS/arch. Without it, the build script cross-compiles for all platforms (linux, darwin, win32 x x64, arm64).

To rebuild after pulling changes:

```bash
cd opencode
git pull
bun install
cd packages/opencode
bun run build -- --single
sudo cp dist/opencode-linux-*/bin/opencode /usr/local/bin/opencode
sudo systemctl restart opencode
```

### 2. Choose a Service User

You can either run as your existing user or create a dedicated one.

**Option A: Use your existing user (recommended for development)**

If you want opencode to read/write files in your home directory (e.g. `/home/exedev`), run the service as that user. Skip to step 3 and use your username in the systemd unit.

**Option B: Create a dedicated user**

For a more isolated setup:

```bash
sudo useradd --system --create-home --shell /bin/bash opencode
```

Note that a dedicated user will only have access to its own home directory. If you need opencode to work with files elsewhere, adjust `ReadWritePaths` in the service unit accordingly.

### 3. Configure Environment Variables

Create an environment file that systemd will load. This keeps secrets out of the service unit.

```bash
sudo mkdir -p /etc/opencode
sudo tee /etc/opencode/env > /dev/null << 'EOF'
# Server authentication (required for public exposure)
OPENCODE_SERVER_PASSWORD=your-strong-password-here
OPENCODE_SERVER_USERNAME=opencode

# Optional: disable auto-update in server context
OPENCODE_DISABLE_AUTOUPDATE=true
EOF

# Restrict permissions (contains secrets)
sudo chmod 600 /etc/opencode/env
sudo chown root:root /etc/opencode/env
```

#### AI Provider Credentials

OpenCode stores provider credentials (API keys, OAuth tokens) on disk at `~/.local/share/opencode/auth.json` (XDG data directory, mode 600). If you have already configured providers through the OpenCode UI or the `/auth/:providerID` API endpoint, the server will read them from disk automatically — no environment variables needed.

If you haven't configured providers yet, you have two options:

1. **Configure via the web UI** — start the server, open the webapp, and add providers through the settings interface. Credentials are persisted to `auth.json` and survive restarts.

2. **Set environment variables** — add provider keys to `/etc/opencode/env`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   ```

> **Note:** When running as the `opencode` system user, the auth file will be at `/home/opencode/.local/share/opencode/auth.json`. If migrating from a personal user setup, copy the auth file to the service user's XDG data path.

**Environment variable reference:**

| Variable | Required | Description |
|---|---|---|
| `OPENCODE_SERVER_PASSWORD` | Yes | Password for HTTP Basic Auth |
| `OPENCODE_SERVER_USERNAME` | No | Username for HTTP Basic Auth (default: `opencode`) |
| `ANTHROPIC_API_KEY` | No | API key for Anthropic/Claude (if not configured via UI) |
| `OPENAI_API_KEY` | No | API key for OpenAI (if not configured via UI) |
| `OPENCODE_CONFIG` | No | Path to a custom config file |
| `OPENCODE_CONFIG_DIR` | No | Custom config directory |
| `OPENCODE_DISABLE_AUTOUPDATE` | No | Set `true` to disable auto-update checks |
| `OPENCODE_DISABLE_LSP_DOWNLOAD` | No | Set `true` to skip LSP server downloads |

### 4. Create the systemd Service

```bash
sudo tee /etc/systemd/system/opencode.service > /dev/null << 'EOF'
[Unit]
Description=OpenCode Headless Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# Use your own user to allow file access in your home directory
User=exedev
Group=exedev
WorkingDirectory=/home/exedev

# Load environment variables (contains server password)
# IMPORTANT: This file must exist or the service will fail to start.
# Create it even if empty: sudo touch /etc/opencode/env
EnvironmentFile=/etc/opencode/env

# Start the headless server on all interfaces
ExecStart=/usr/local/bin/opencode serve --hostname 0.0.0.0 --port 4096

# Restart policy
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/exedev
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opencode

[Install]
WantedBy=multi-user.target
EOF
```

### 5. Enable and Start the Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable opencode
sudo systemctl start opencode
```

### 6. Verify

```bash
# Check service status
sudo systemctl status opencode

# View logs
sudo journalctl -u opencode -f

# Test the API (from the VM itself)
curl -u opencode:your-strong-password-here http://localhost:4096/path
```

## Recommended: Reverse Proxy with TLS

HTTP Basic Auth transmits credentials in base64 (not encrypted). For public exposure, put a reverse proxy in front to terminate TLS.

### Caddy (automatic HTTPS)

```bash
sudo apt install caddy
```

```
# /etc/caddy/Caddyfile
opencode.yourdomain.com {
    reverse_proxy localhost:4096
}
```

With Caddy, TLS certificates are provisioned automatically via Let's Encrypt. Ensure your DNS A record points to the VM's public IP.

### nginx

```nginx
# /etc/nginx/sites-available/opencode
server {
    listen 443 ssl;
    server_name opencode.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/opencode.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/opencode.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4096;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # SSE support (disable buffering)
        proxy_buffering off;
        proxy_cache off;

        # Pass client info
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long-lived connections (SSE heartbeat is 30s)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

When using a reverse proxy with a custom domain, add the domain to the CORS whitelist. Either add it to the environment file:

```bash
# In /etc/opencode/env
OPENCODE_CONFIG_CONTENT='{"server":{"cors":["https://opencode.yourdomain.com"]}}'
```

Or pass it as a CLI flag in the systemd service:

```bash
ExecStart=/usr/local/bin/opencode serve --hostname 0.0.0.0 --port 4096 --cors https://opencode.yourdomain.com
```

### Firewall

If binding directly on port 4096 without a reverse proxy, open the port:

```bash
sudo ufw allow 4096/tcp
```

If using a reverse proxy, only expose 80/443 and keep 4096 internal:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## Docker Alternative

OpenCode ships with a Dockerfile. You can run it in a container instead of a bare-metal systemd service:

```bash
docker run -d \
  --name opencode \
  --restart unless-stopped \
  -p 4096:4096 \
  -e OPENCODE_SERVER_PASSWORD=your-strong-password-here \
  -v opencode-data:/root/.local/share/opencode \
  opencode serve --hostname 0.0.0.0 --port 4096
```

The volume mount persists provider credentials and session data across container restarts. Configure providers through the web UI after first launch, or pass API keys as additional `-e` flags.

## Configuration

OpenCode reads configuration from `~/.opencode/opencode.jsonc` (global) and `opencode.jsonc` in the project directory. For server-relevant settings:

```jsonc
{
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0",
    "mdns": false,
    "cors": ["https://opencode.yourdomain.com"]
  }
}
```

These values serve as defaults and can be overridden by CLI flags.

## Operations

### Logs

```bash
# Follow logs in real time
sudo journalctl -u opencode -f

# View last 100 lines
sudo journalctl -u opencode -n 100

# View logs since last boot
sudo journalctl -u opencode -b
```

### Restart / Stop

```bash
sudo systemctl restart opencode
sudo systemctl stop opencode
```

### Update

```bash
sudo systemctl stop opencode
# Replace the binary
sudo cp /path/to/new/opencode /usr/local/bin/opencode
sudo systemctl start opencode
```

## API Reference

The server exposes a full REST API. When the server is running, visit `/doc` for the interactive OpenAPI documentation.

Key endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/session` | GET | List sessions |
| `/session` | POST | Create a new session |
| `/session/:id/message` | POST | Send a message/prompt |
| `/event` | GET | SSE event stream |
| `/path` | GET | Get server paths |
| `/vcs` | GET | Get git branch info |
| `/agent` | GET | List available agents |
| `/doc` | GET | OpenAPI documentation |

## Troubleshooting

**Server won't start / port in use:**
Check if something else is on port 4096: `ss -tlnp | grep 4096`. Change the port in the service or config.

**Authentication not working:**
Verify `OPENCODE_SERVER_PASSWORD` is set: `sudo systemctl show opencode -p Environment` won't show `EnvironmentFile` contents, so check `/etc/opencode/env` directly.

**Web UI not loading:**
The web UI is proxied from `app.opencode.ai`. The server must have outbound internet access to serve the frontend assets. Ensure DNS resolution and HTTPS egress are not blocked.

**SSE/WebSocket disconnects behind proxy:**
Ensure your reverse proxy has `proxy_buffering off` (nginx) and long read timeouts. The server sends heartbeats every 30 seconds to keep connections alive.

**CORS errors in browser:**
Add your domain to the CORS whitelist via `--cors` flag or the `server.cors` config array.
