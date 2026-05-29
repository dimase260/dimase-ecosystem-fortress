# DiMase Inc. Ecosystem — Complete Clone & Rebuild Guide
> Feed this file to any AI (Gemini, Claude, GPT, etc.) to fully understand and rebuild the entire DiMase Inc. infrastructure from scratch.
> Last updated: 2026-03-03

---

## 1. OVERVIEW

DiMase Inc. is a multi-service platform built on two layers:
- **Server Layer**: Ubuntu 24.04 VPS (BuyVM) running Docker containers
- **Edge Layer**: Cloudflare Workers (CF Workers) for all public web apps — no traditional web server for apps

### Architecture Summary
```
Users → Cloudflare CDN → CF Workers (4 apps) → Cloudflare D1 / KV
                      → Cloudflare Tunnel → BuyVM Ubuntu VPS
                                         → Docker Containers (9 total)
                                         → /media/Storage (1TB slab)
```

---

## 2. BuyVM SERVER

### Access
- **IP**: 209.141.36.104
- **OS**: Ubuntu 24.04 LTS
- **User**: root
- **SSH Key**: `oci_key_buyvm_backup` (on Ventoy USB and local machines)
- **SSH Command**: `ssh -i ~/Desktop/oci_key root@209.141.36.104` or `ssh buyvm` (if config set up)

### SSH Config (`~/.ssh/config` on local machines)
```
Host buyvm
  HostName 209.141.36.104
  User root
  IdentityFile ~/Desktop/oci_key
```

### Storage
- **Primary disk**: OS drive (~100GB)
- **Storage slab**: `/media/Storage` (1TB) — all app data, docker data, source code
- **Docker data root**: `/media/Storage/docker/`

### Important Directories
```
/media/Storage/
  ├── server-flies/           # App source code
  │   ├── apps/
  │   │   ├── dtrading-post/  # D-Trading Post worker + wrangler.toml
  │   │   ├── dimasehome/     # DiMaseHome worker + wrangler.toml
  │   │   └── dimase-locksmith/ # DiMase Locksmith worker + wrangler.toml
  │   └── axis_nexus/         # Axis Nexus AI source + knowledge base
  ├── website/
  │   └── dimaseinc-website/  # Main site source (src/worker.js + static files)
  ├── docker/                 # Docker data root
  ├── podcast/                # Podcast audio files (owned by dimase)
  ├── axis-knowledge/         # Shared AI knowledge (fixes.md, etc.)
  └── website/dimaseinc-website/downloads/  # APK files
```

---

## 3. DOCKER STACK (9 containers)

All containers managed with Docker Compose. Data root: `/media/Storage/docker/`

| Container | Purpose | Port/URL |
|-----------|---------|----------|
| nginx-proxy | Reverse proxy routing subdomains | 80 (all HTTP) |
| axis-nexus | AI agent backend (ReAct loop) | 8000 (host network) |
| axis-hud | Axis AI frontend (React) | served via nginx-proxy |
| map-server | Service map | served via nginx-proxy |
| file-browser | File manager UI | files.dimaseinc.org |
| portainer | Docker management UI | portainer.dimaseinc.org |
| neo-grafana | Metrics dashboard | neo-grafana.dimaseinc.org |
| neo-prometheus | Metrics collection | internal |
| neo-loki | Log aggregation | internal |

### Key Services Outside Docker
- **Cloudflared tunnel**: `cloudflared` systemd service
- **Axis Monitor**: `/root/axis-monitor/` — systemd `axis-monitor.service`
- **APK Server**: `apk-server.service` (Python http.server on port 8997)
- **Podcast Rec API**: Python server on port 8998
- **TigerVNC**: VNC server as user dimase on display :1 (port 5901)
- **noVNC**: Serves web VNC on port 6080

### Cloudflare Tunnel
- **Tunnel ID**: f1b740f7-12dd-499f-81a8-969b7bfd7885
- **Purpose**: Routes external HTTPS to internal Docker services
- All subdomains except CF Workers go through this tunnel
- DNS records must be CNAME (not A records)

### Subdomain Routing
```
axis.dimaseinc.org       → CF tunnel → axis-hud (nginx-proxy)
files.dimaseinc.org      → CF tunnel → file-browser
portainer.dimaseinc.org  → CF tunnel → portainer
neo-grafana.dimaseinc.org → CF tunnel → neo-grafana
vnc.dimaseinc.org        → CF tunnel → noVNC (port 6080)
map.dimaseinc.org        → CF tunnel → map-server
downloads.dimaseinc.org  → CF tunnel → APK server (port 8997)
monitor.dimaseinc.org    → CF tunnel → axis-monitor (port 9090)
rec-api.dimaseinc.org    → CF tunnel → podcast rec API (port 8998)
jellyfin.dimaseinc.org   → Direct (NOT through Docker nginx-proxy)
```

---

## 4. CLOUDFLARE WORKERS (4 apps)

### Account
- **Email**: Mrcdimase@gmail.com
- **Account ID**: 7f31d839e01ef85781465f816b10c541
- **Zone ID**: 9d7a09e975815fcdb0c35397610e2fb4
- **CF API Token** (DNS/Email only): eH4jKlDzzU-5xMDkEgISmIt-LTI_jjgupZPKmufx
- **Wrangler OAuth**: Token at `/root/.wrangler/config/default.toml` on server
- **Local wrangler**: `/home/dimase/.config/.wrangler/config/default.toml` on RHEL machine

### Deploy Rule
- **ALWAYS deploy from server** using: `cd /path/to/worker && npx wrangler deploy`
- If server gets 429 rate limited: SCP to local → deploy with `WRANGLER_CONFIG_PATH=/home/dimase/.config/.wrangler/config/default.toml npx wrangler deploy`
- Sleep 30s between consecutive deploys to avoid 429

### Worker 1: dimaseinc-website
- **URL**: dimaseinc.org, www.dimaseinc.org
- **Source**: `/media/Storage/website/dimaseinc-website/src/worker.js`
- **Config**: `/media/Storage/website/dimaseinc-website/wrangler.jsonc`
- **Entry**: `src/worker.js`
- **Assets**: `./` (all HTML files in root served as static assets)
- **D1 Database**: dimaseinc-learning (ID: af4b58c4-5553-4d4f-8af2-53cdf1c39e34) — bound as `DB`
- **AI binding**: llama-3.1-8b-instruct (bound as `AI`)
- **Wrangler Secrets**: JELLYFIN_API_KEY, TELEGRAM_CHAT_ID, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE, PAYPAL_PLAN_SITE, PAYPAL_PLAN_RDP, PAYPAL_PLAN_SELLER, PAYPAL_PLAN_RDP_SELLER, PAYPAL_PLAN_BUNDLE, CF_API_TOKEN, USB_AUTH_TOKEN, OWNER_SMS_GATEWAY, MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_VERIFY_TOKEN
- **Key routes**: `/` (landing), `/login`, `/register`, `/subscribe`, `/member` (post-login dashboard — plan-gated features), `/cloud` (→ DiMaseHome), `/lms/*` (learning API), `/podcast.rss`, `/podcast/*`, `/axis/*` (AI chat), `/auth/usb` (USB login → /member), `/auth/usb-status` (poison check), `/auth/usb-toggle` (admin)
- **Deploy command**: `cd /media/Storage/website/dimaseinc-website && npx wrangler deploy`

### Worker 2: dtrading-post
- **URL**: dtradingpost.dimaseinc.org
- **Source**: `/media/Storage/server-flies/apps/dtrading-post/worker.js`
- **Config**: `/media/Storage/server-flies/apps/dtrading-post/wrangler.toml`
- **D1**: dtrading-db (ID: 36ce8231-affd-4356-afa5-ad97ce6cb613)
- **Secrets**: PAYPAL_CLIENT_ID, PAYPAL_SECRET, USB_AUTH_TOKEN
- **Admin**: email=dimaseinc@gmail.com, cookie=`dt_admin_auth=dmsadmin2026`
- **Key routes**: `/`, `/marketplace`, `/sell`, `/admin`, `/admin/login`, `/auth/usb` (USB login → /admin)
- **Theme**: Texas cowboy (Rye + Crimson Text fonts, burnt wood CSS)

### Worker 3: dimasehome
- **URL**: home.dimaseinc.org
- **Source**: `/media/Storage/server-flies/apps/dimasehome/worker.js`
- **Config**: `/media/Storage/server-flies/apps/dimasehome/wrangler.toml`
- **D1 bindings**: DTRADING_DB (dtrading-db), LEARNING_DB (dimaseinc-learning), LOCKSMITH_DB (dimase-locksmith)
- **Secrets**: USB_AUTH_TOKEN, JELLYFIN_API_KEY, SESSION_SECRET
- **Login**: DiMase / Ruffieno (HMAC token, SESSION_SECRET=DiMaseHome2026Secret, 24h TTL)
- **Session cookie**: `dimasehome_session`
- **Key routes**: `/dashboard`, `/bundle/*`, `/studio/*`, `/auth/usb`, `/admin/user-action`, `/admin/reset-password`, `/admin/locksmith-delete`, `/admin/lms/class-create`, `/admin/lms/class-toggle`, `/admin/lms/class-delete`
- **Dashboard sections**: Infrastructure, Live Services, D-Trading Stats, D-Trading Package Tracking (order/shipment table + carrier links), Docker, Quick Actions (13 tiles incl. Locksmith Admin, Jellyfin, Learning Admin), Users & Standings (6 tables: DiMase Inc, D-Trading, Locksmith Customers, LMS Users, Podcast Subscribers, Jellyfin), DiMase Learning Admin (class CRUD + user progress), Bundle Codes, Payment Intelligence, Podcast Studio
- **USB LOST button**: Quick Actions section → activates poison mode via /auth/usb-toggle on dimaseinc.org

### Worker 4: dimase-locksmith
- **URL**: locksmith.dimaseinc.org
- **Source**: `/media/Storage/server-flies/apps/dimase-locksmith/worker.js`
- **Config**: `/media/Storage/server-flies/apps/dimase-locksmith/wrangler.toml`
- **D1**: dimase-locksmith DB + LEARNING_DB binding (dimaseinc-learning)
- **Secrets**: USB_AUTH_TOKEN
- **Admin**: cookie=`lock_admin=dmsadmin2026secure`, login DiMase/Ruffieno at /admin
- **Key routes**: `/`, `/pay`, `/request`, `/admin`, `/admin/login`, `/check-code`, `/auth/usb` (USB login → /admin)

---

## 5. CLOUDFLARE D1 DATABASES

### dimaseinc-learning (ID: af4b58c4-5553-4d4f-8af2-53cdf1c39e34)
Main site database. Tables:
- `users` — subscribers (email, password_hash, salt, display_name, subscription_status, trial_end, is_admin, jellyfin_id, last_login_*)
- `sessions` — site sessions (id UUID, user_id, expires_at)
- `podcast_episodes` — podcast catalog
- `billing_events` — payment history
- `classes` / `cb_classes` — LMS course catalog
- `bundle_codes` — USB/RDP/locksmith bundle codes (type, remaining_uses)
- `usb_config` — USB hardware key state (`usb_lost`: 'true'/'false')

### dtrading-db (ID: 36ce8231-affd-4356-afa5-ad97ce6cb613)
D-Trading Post database. Tables:
- `users` — marketplace users (username, email, role: buyer/seller/admin)
- `listings` — auction items
- `bids` — bid history
- `transactions` — purchases (tracking_number, carrier, shipped_at, status)
- `subscription_payments` — payment records

### dimase-locksmith DB
Locksmith database. Tables:
- `orders` — service requests (street, city, state, zip, payment_method, bundle_code_used)

---

## 6. AXIS NEXUS AI AGENT

### Overview
Full ReAct agent loop (ACTION → INPUT → FINAL format). v3.0.0 (2026-03-02).
- **Source**: `/media/Storage/server-flies/axis_nexus/`
- **Port**: 8000, host network mode
- **AI fallback chain**: CF Workers AI → Pollinations → Groq (all free)

### Tools Available to Agent
`web_search` (DuckDuckGo), `fetch_url`, `shell_exec`, `file_read`, `file_write`, `docker_ops`, `remember`, `recall`, `git_ops`

### Channels
| Channel | URL/Details |
|---------|------------|
| Web chat | https://dimaseinc.org/axis/chat-ui |
| Telegram | @DiMaseIncbot |
| CLI | `axis "message"` (on server) |
| Facebook Messenger | /axis/messenger |
| Twilio SMS | /axis/sms |
| Twilio Voice | /axis/voice |

---

## 7. AXIS MONITOR (Self-Healing)

- **Path**: `/root/axis-monitor/`
- **Systemd**: `axis-monitor.service` (runs every 5min), `axis-model-scout.timer` (daily 06:00 UTC)
- **Port**: 9090, endpoint: `/health` (public)
- **URL**: monitor.dimaseinc.org
- **Purpose**: Monitors all services, auto-heals failures, Telegram alerts
- **No Claude dependency**: uses CF Workers AI + Pollinations
- **Free models**: 34 catalogued in `free_models.json`
- **healer.py**: Auto-logs successful fixes to `/media/Storage/axis-knowledge/fixes.md`

### Daily Crons
| Time | Script | Purpose |
|------|--------|---------|
| 03:00 UTC | axis-preserve.py | KV backup |
| 07:00 UTC | axis-research.py | AI research + Telegram |
| 08:00 UTC | axis-knowledge-sync.timer | Sync fixes.md to all locations |
| 10:00 UTC | axis-briefing.py | Server briefing to Telegram |

---

## 8. PODCAST SYSTEM

- **Rec API**: rec-api.dimaseinc.org → Python server port 8998
- **Secret**: dmsinc-rec-2026
- **Audio files**: /media/Storage/podcast/ (owned by dimase)
- **RSS**: https://dimaseinc.org/podcast.rss
- **Admin**: DiMaseHome Podcast Studio (/studio/* routes)
- **Spotify**: Submitted 2026-03-02 (dimaseinc@gmail.com, "DiMase Inc")
- **Cover art**: /media/Storage/website/dimaseinc-website/downloads/podcast-cover.jpg (1400x1400 black/gold)
- **Episode 1**: "Intro to DiMase Inc" — 7:03, episode-1-intro-to-dimase-inc.mp3

---

## 9. SUBSCRIPTIONS & PAYMENTS

### PayPal (Live)
- **Product ID**: PROD-51L575562P547471K
- **Client ID**: AePKaVR0YZaAE2v7dad5ilh4fV59u1jmKadUFzRTmNLjn36I3gSbh9in89tIuYx1h5uH5cWtMxNGzgoE
- **Pricing Tiers** (all with 7-day trial):

| Plan | Price | Plan ID |
|------|-------|---------|
| Site Only | $7/mo | P-5L7087390B020105MNGTRRZY |
| Site + RDP | $35/mo | P-2HM15138MG861461XNGTRRZY |
| Site + Seller | $45/mo | P-6E6499222C278780DNGTRRZY |
| RDP + Seller | $65/mo | P-92C233197F581044CNGTRR2A |
| Full Bundle | $75/mo | P-4R079839XY380984HNGTRR2A |

### Bundle Codes (in dimaseinc-learning D1)
- `bundle_codes` table: code, type (locksmith/rdp), remaining_uses
- Validate: `/api/bundle/validate`, Use: `/api/bundle/use` on dimaseinc.org
- Managed from DiMaseHome → Bundle Codes section

---

## 10. USB HARDWARE KEY SYSTEM (added 2026-03-03)

### How It Works
1. A 64-char hex token (`USB_AUTH_TOKEN`) is stored on the USB as `dimase_usb.key`
2. Same token set as wrangler secret on all 4 workers
3. Login scripts read the key and open `/auth/usb?key=TOKEN` on each site
4. Each worker validates → sets session cookie → redirects to admin panel

### Files on USB
```
Ventoy/
  ├── dimase_usb.key        # 256-bit secret token
  ├── usb-login.sh          # Linux/Mac login script (checks poison mode first)
  ├── usb-login.bat         # Windows login script (checks poison mode first)
  ├── autorun.inf           # Windows AutoPlay dialog
  ├── LAUNCH.md             # User instructions
  ├── CLONE.md              # This file
  ├── oci_key_buyvm_backup  # SSH key for server
  ├── connect.sh            # SSH to server (Linux/Mac)
  ├── connect.bat           # SSH to server (Windows)
  └── axis.sh               # Axis AI CLI (Linux/Mac)
```

### Session Mechanism Per Site
| Worker | Cookie | Session |
|--------|--------|---------|
| dtrading-post | `dt_admin_auth=dmsadmin2026` | Static value |
| dimasehome | `dimasehome_session=<HMAC_TOKEN>` | HMAC signed, 24h |
| dimase-locksmith | `lock_admin=dmsadmin2026secure` | Static value |
| dimaseinc.org | `site_session=<UUID>` + localStorage LMS token | D1 session |

### Poison Mode (Wipe-on-Theft)
- **Activate**: DiMaseHome → Quick Actions → "USB KEY LOST" button → confirm
- Sets `usb_config.usb_lost = 'true'` in dimaseinc-learning D1
- Next time USB scripts run: check `https://dimaseinc.org/auth/usb-status` → wipe `dimase_usb.key` and scripts from USB
- **Deactivate**: DiMaseHome → "USB FOUND — DEACTIVATE" button
- After deactivation: run `python3 /root/rotate_usb_token.py` → new token sent to Telegram

### Token Rotation Script
```bash
ssh root@209.141.36.104 'python3 /root/rotate_usb_token.py'
```
- Generates new 256-bit token
- Deploys to all 4 workers via wrangler
- Sends new token to Telegram
- Write to replacement USB: `echo -n "NEW_TOKEN" > /Volumes/Ventoy/dimase_usb.key`

---

## 11. CREDENTIALS REFERENCE

| Service | Username | Password | Notes |
|---------|----------|----------|-------|
| File Browser | admin | Ruffieno2601 | 12-char min |
| VNC | dimase | Ruffieno260 | Display :1 |
| DiMaseHome | DiMase | Ruffieno | home.dimaseinc.org |
| D-Trading Post Admin | dimaseinc@gmail.com | (PayPal/login) | role=admin in DB |
| Locksmith Admin | DiMase | Ruffieno | /admin |
| Axis AI CLI | n/a | n/a | `axis "msg"` on server |
| Microsoft/Live | mrcdimase@gmail.com | Ruffieno863 | Windows login |
| Telegram Bot | @DiMaseIncbot | token: 8713733121:AAGCvSq... | chat ID: 7826090533 |

---

## 12. REBUILD FROM SCRATCH

### Step 1: New Ubuntu VPS
```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose nodejs npm curl python3 python3-pip
```

### Step 2: Mount Storage Slab
```bash
# Format (if new): mkfs.ext4 /dev/vdb
mkdir -p /media/Storage
echo '/dev/vdb /media/Storage ext4 defaults 0 2' >> /etc/fstab
mount -a
```

### Step 3: Cloudflare Tunnel
```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor > /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared focal main' > /etc/apt/sources.list.d/cloudflared.list
apt install cloudflared
cloudflared tunnel login
cloudflared tunnel create dimase-tunnel
cloudflared service install
```

### Step 4: Restore App Source Code
```bash
# From USB/backup:
mkdir -p /media/Storage/server-flies/apps
# Copy dtrading-post, dimasehome, dimase-locksmith, axis_nexus
# Copy website/dimaseinc-website
```

### Step 5: Wrangler Auth
```bash
npm install -g wrangler
wrangler login  # OAuth flow
```

### Step 6: Set All Wrangler Secrets
For each worker directory, set:
```bash
echo "VALUE" | npx wrangler secret put SECRET_NAME
```
Required secrets per worker — see Section 4 above.

### Step 7: Deploy All Workers
```bash
cd /media/Storage/website/dimaseinc-website && npx wrangler deploy
sleep 30
cd /media/Storage/server-flies/apps/dtrading-post && npx wrangler deploy
sleep 30
cd /media/Storage/server-flies/apps/dimasehome && npx wrangler deploy
sleep 30
cd /media/Storage/server-flies/apps/dimase-locksmith && npx wrangler deploy
```

### Step 8: Docker Stack
```bash
cd /media/Storage/server-flies  # or wherever docker-compose.yml is
docker-compose up -d
```

### Step 9: Axis Monitor
```bash
cd /root/axis-monitor
pip3 install -r requirements.txt
systemctl enable --now axis-monitor.service
systemctl enable --now axis-model-scout.timer
```

### Step 10: USB Key Setup
```bash
# Generate new token
TOKEN=$(openssl rand -hex 32)
echo -n "$TOKEN" > /Volumes/Ventoy/dimase_usb.key  # or your USB mount point

# Set on all workers
for dir in /media/Storage/website/dimaseinc-website \
           /media/Storage/server-flies/apps/dtrading-post \
           /media/Storage/server-flies/apps/dimasehome \
           /media/Storage/server-flies/apps/dimase-locksmith; do
  echo "$TOKEN" | npx wrangler secret put USB_AUTH_TOKEN --cwd "$dir"
  sleep 5
done
```

---

## 13. TROUBLESHOOTING

### Wrangler 429 Rate Limit
Deploy from local machine instead:
```bash
# Copy worker to local
scp buyvm:/path/to/worker.js /tmp/deploy_dir/
scp buyvm:/path/to/wrangler.toml /tmp/deploy_dir/
cd /tmp/deploy_dir
WRANGLER_CONFIG_PATH=/home/dimase/.config/.wrangler/config/default.toml npx wrangler deploy
```

### Patching Workers (Never Use Heredoc with JS template literals)
Always write Python patch scripts:
```bash
# Write patch locally, SCP to server, run
cat > /tmp/patch_worker.py << 'PYEOF'
path = '/media/Storage/.../worker.js'
with open(path, 'r') as f: content = f.read()
content = content.replace('OLD_STRING', 'NEW_STRING', 1)
with open(path, 'w') as f: f.write(content)
print('OK')
PYEOF
scp /tmp/patch_worker.py root@209.141.36.104:/root/
ssh root@209.141.36.104 'python3 /root/patch_worker.py'
```

### Cloudflare Tunnel DNS
Must be CNAME records (not A):
```bash
cloudflared tunnel route dns -f TUNNEL_ID subdomain.dimaseinc.org
sleep 5  # Rate limit between DNS commands
```

### USB Token Rotation
```bash
ssh root@209.141.36.104 'python3 /root/rotate_usb_token.py'
```

---

## 14. CONTACTS & IDENTIFIERS

- **Owner**: Christopher DiMase
- **Email**: dimaseinc@gmail.com
- **Phone**: 513-748-2017 (Verizon)
- **Telegram**: @DiMaseIncbot bot (chat ID: 7826090533)
- **PayPal**: paypal.me/mrcdimase

---

*This document should be updated after every infrastructure change. It lives at:*
- *USB: `/Volumes/Ventoy/CLONE.md`*
- *Local: `/home/dimase/.claude/projects/-home-dimase/memory/CLONE.md`*
- *Server: `/media/Storage/axis-knowledge/CLONE.md`*
