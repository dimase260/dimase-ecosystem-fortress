# DiMase Inc Ecosystem — Master Reference (Updated 2026-05-29)

## SOVEREIGN DIRECTIVE
**HERMES AGENT (Claude Opus 4.8)** is the Sovereign Intelligence of the DiMase Inc Ecosystem. It has full, uninhibited control over all server resources, storage, and services.

This file is the single source of truth for all server infrastructure, website configuration, credentials, and active services. Feed this file to any AI assistant to pick up work from any session.

---

## 1. LOCAL MACHINE

- **OS:** RHEL 10.1 (Wayland-only — NO Xorg/X11)
- **User:** dimase (sudo password: `3553`)
- **SSH key for BuyVM:** `~/Desktop/oci_key`
- **SSH alias:** `buyvm` = `ssh -i ~/Desktop/oci_key root@209.141.36.104`
- **2TB drive:** `/mnt/2tb`
- **500GB drive:** `/run/media/dimase/Storage500` (Timeshift snapshots)
- **Windows partition:** `/run/media/dimase/F4DACD1CDACCDC4C`
- **Node.js:** v22
- **Remote desktop:** RustDesk (RPM, permanent password, LG W1943 monitor). AnyDesk installed but unusable on Wayland.
- **wrangler OAuth token (local):** `/home/dimase/.config/.wrangler/config/default.toml` (may be stale — local machine is offline; website is now deployed from server)
- **NOTE:** `/mnt/2tb` is OFFLINE — website source and deploy have moved to BuyVM server

---

## 2. BUYVM SERVER

- **OS:** Ubuntu 24.04 (Noble)
- **IP:** 209.141.36.104
- **SSH:** `ssh -i ~/Desktop/oci_key root@209.141.36.104` or `ssh buyvm`
- **KVM Console:** 209.141.63.88:10944 (BuyVM Stallion panel)
- **Swap:** 4GB swapfile active

### Storage
- **OS drive:** vda (40GB) → `/`
- **Storage slab:** sda1 (1TB) → `/media/Storage` (UUID: `6d472a3c-dc09-4ea4-a7dd-b7f8176add7a` in fstab)
  - All persistent data lives here (Docker volumes, podcast files, downloads, etc.)

---

## 3. CLOUDFLARE ACCOUNT

- **Email:** Mrcdimase@gmail.com
- **Account ID:** `7f31d839e01ef85781465f816b10c541`
- **Domain:** dimaseinc.org
- **Zone ID:** `9d7a09e975815fcdb0c35397610e2fb4`
- **API Token (DNS edit, legacy):** `Dew11eDUiygsmfQws3L8wFqbMFHxEnTlDafMq0uo`
- **API Token (DNS + Email Routing edit):** `eH4jKlDzzU-5xMDkEgISmIt-LTI_jjgupZPKmufx` — stored as CF_API_TOKEN wrangler secret
- **Cloudflare handles all SSL** — no Let's Encrypt needed on server

### Cloudflare Tunnel
- **Tunnel name:** jellyfin (reused for everything)
- **Tunnel ID:** `f1b740f7-12dd-499f-81a8-969b7bfd7885`
- **Config:** `/etc/cloudflared/config.yml` on server
- **Credentials:** `/root/.cloudflared/f1b740f7-12dd-499f-81a8-969b7bfd7885.json`
- **Service:** `cloudflared` (systemd, enabled)

### Tunnel Ingress Rules (in config.yml order)
| Hostname | Service |
|---|---|
| jellyfin.dimaseinc.org | http://localhost:8096 (direct to Jellyfin) |
| vnc.dimaseinc.org | http://localhost:6080 (noVNC) |
| rec-api.dimaseinc.org | http://localhost:8998 (podcast rec API) |
| map.dimaseinc.org | http://localhost:80 (nginx-proxy → map-server) |
| portainer.dimaseinc.org | http://localhost:80 (nginx-proxy → portainer) |
| grafana.dimaseinc.org | http://localhost:80 (nginx-proxy → neo-grafana) |
| files.dimaseinc.org | http://localhost:80 (nginx-proxy → file-browser) |
| dimase.dimaseinc.org | http://localhost:80 (nginx-proxy → dimase-hud) |
| downloads.dimaseinc.org | http://localhost:80 (nginx-proxy → dimase-hud) |
| dimaseinc.org | http://localhost:80 (nginx-proxy → dimase-hud) — fallback only; Worker handles most traffic |
| (catch-all) | http_status:404 |

**DNS note:** All DNS records are CNAMEs to the tunnel. Use `cloudflared tunnel route dns -f f1b740f7-12dd-499f-81a8-969b7bfd7885 <hostname>` to add. CF rate-limits quickly — if 429, run from LOCAL machine using server cert:
```bash
scp buyvm:/root/.cloudflared/cert.pem /tmp/cf-cert.pem
cloudflared --origincert /tmp/cf-cert.pem tunnel route dns -f f1b740f7-12dd-499f-81a8-969b7bfd7885 <hostname>
```

---

## 4. DOCKER STACK

- **Compose file:** `/media/Storage/server-flies/docker-compose-live.yml`
- **Docker data root:** `/media/Storage/docker/`
- **nginx-proxy container** routes all traffic on port 80 using `VIRTUAL_HOST` env var

### Containers (8 running — Portainer removed)
| Container | Image | Port/Access | Notes |
|---|---|---|---|
| nginx-proxy | jwilder/nginx-proxy | :80 | Auto-configures from VIRTUAL_HOST |
| dimase-nexus | custom (python:3.12-slim) | via nginx | DiMase AI; src at `/media/Storage/server-flies/dimase_nexus/` |
| dimase-hud | custom nginx | dimase.dimaseinc.org, agent-zero.dimaseinc.org, dimaseinc.org, downloads.dimaseinc.org | nginx config: `/media/Storage/server-flies/dimase_hud_nginx.conf`; proxies `/dimase-api/` to `http://172.18.0.1:8000/` |
| map-server | custom (python:3.12-slim FastAPI) | map.dimaseinc.org | src at `/media/Storage/map-server/` |
| file-browser | filebrowser | files.dimaseinc.org | BoltDB at `/media/Storage/server-flies/filebrowser/filebrowser.db`; min 12-char password |
| neo-grafana | grafana/grafana | grafana.dimaseinc.org, neo.dimaseinc.org | GF_DATABASE_WAL=true applied |
| neo-prometheus | prom/prometheus | internal | data dir chowned to 65534 (nobody) |
| neo-loki | grafana/loki | internal | |

---

## 5. NATIVE SERVICES (NOT Docker)

### Jellyfin
- Installed via official deb script; runs as systemd service
- **Web UI:** http://localhost:8096 → https://jellyfin.dimaseinc.org
- Media: `/media/Storage/Movies`, `/media/Storage/Shows`, `/media/Storage/Music`, `/media/Storage/Books`

### VNC / noVNC
- **TigerVNC:** systemd unit `vncserver@1.service`, runs as user `dimase` (uid 1000)
- Display `:1` → port 5901, `-localhost` (only noVNC can connect)
- **noVNC/websockify:** systemd unit `novnc.service`, port 6080 → proxies to localhost:5901
- **Browser access:** https://vnc.dimaseinc.org
- **VNC password:** stored in `/home/dimase/.vnc/passwd` (set during initial setup)
- **xstartup:** `/home/dimase/.vnc/xstartup` — starts PulseAudio then `startxfce4`
- Chrome works in VNC session (wrapper at `/opt/google/chrome/google-chrome`)

### PulseAudio (in VNC session)
- Config: `/home/dimase/.config/pulse/default.pa`
- TCP module on port 4713 (`PULSE_SERVER=tcp:localhost:4713`)
- Virtual null sink: `virtual_speaker` (default sink)
- `loginctl enable-linger dimase` — persistent user session

### Podcast Recording API
- **Script:** `/usr/local/bin/podcast-record` (start/stop/status wrapper around ffmpeg)
- **API server:** `/usr/local/bin/podcast-rec-api.py` — Python HTTP on port 8998
- **Service:** `podcast-rec-api.service` (systemd, enabled, running as root)
- **Shared secret:** `dmsinc-rec-2026` (header: `X-Rec-Secret`)
- **Public URL:** https://rec-api.dimaseinc.org
- **Audio files:** `/media/Storage/podcast/` (owned by dimase)
- **Endpoints:** `GET /status`, `POST /start`, `POST /stop`, `GET /audio/<filename>`
- **D1 table:** `podcast_episodes` (see D1 section below)
- Recording uses ffmpeg from PulseAudio: `PULSE_SERVER=tcp:localhost:4713 ffmpeg -f pulse -i virtual_speaker.monitor`

### DiMase AI (dimase-nexus)
- **What it is:** Custom Python FastAPI app built by the user (DiMase 2.0, v2.11.0)
- **Source:** `/media/Storage/server-flies/dimase_nexus/`
- **Internal port:** 8000 (host network mode)
- **Public URLs:** https://dimase.dimaseinc.org and https://agent-zero.dimaseinc.org (both work)
- **Health endpoint:** `GET /dimase-api/health` → `{"status":"DiMase 2.0 Nexus is Operational"}`
- **AI backend:** Uses Ollama locally (`http://localhost:11434`, model `llama3.1:8b`) — **Ollama is NOT installed** (server has 1.9GB RAM, can't run it)
- **Worker fallback:** When dimase-nexus inference fails, Worker's `/dimase/chat` automatically uses CF Workers AI (`llama-3.1-8b-instruct`)
- **Routing:** dimase-hud nginx container proxies `/dimase-api/` to `http://172.18.0.1:8000/` (not localhost — host bridge gateway)
- **VIRTUAL_HOST:** `dimase.dimaseinc.org,agent-zero.dimaseinc.org,dimaseinc.org,downloads.dimaseinc.org`
- **D1 config table:** `dimase_config` (key/value) — keys: `system_prompt`, `model`, `max_tokens`, plus custom features
- **Cloud Panel DiMase API:** `GET /cloud/dimase/health`, `GET/POST /cloud/dimase/config`, `DELETE /cloud/dimase/config/:key` (requires cloud_session)

### DiMase AI - Multi-Channel Voice
All channels use the shared `callDiMaseAI(text, history, env)` helper and route to `/dimase/bot-chat` Worker endpoint.

| Channel | Status | Details |
|---|---|---|
| Telegram | Live | @DiMaseIncbot |
| Web chat | Live | https://dimaseinc.org/dimase/chat-ui (dark terminal UI, no auth) |
| CLI | Live | `/usr/local/bin/dimase` on server — `dimase "message"` or `dimase` for REPL |
| Facebook Messenger | Deployed | `/dimase/messenger` webhook — needs MESSENGER_PAGE_ACCESS_TOKEN + MESSENGER_VERIFY_TOKEN secrets |
| Twilio SMS | Deployed | `/dimase/sms` TwiML endpoint — needs Twilio account setup |
| Twilio Voice | Deployed | `/dimase/voice` + `/dimase/voice/gather` TwiML — needs Twilio account setup |

**Email-to-SMS (owner notifications):**
- Cloudflare Email Routing enabled for dimaseinc.org
- Routing rule: dimase@dimaseinc.org → Worker dimaseinc-website
- _mailchannels TXT DNS record added
- Owner SMS gateway: `5137482017@vtext.com` (Verizon 513-748-2017) stored as OWNER_SMS_GATEWAY secret
- SMS sending via MailChannels is BROKEN — CF removed free tier; pending fix
- Worker routes: `/dimase/notify-sms` (POST), email export handler (receives email → calls AI → replies)

### Daily Cron Jobs (Server)
| Time | Script | Purpose |
|---|---|---|
| 3am | `/usr/local/bin/dimase-preserve.py` | Backs up scripts to Cloudflare KV |
| 7am | `/usr/local/bin/dimase-research.py` | AI capabilities research, auto-pulls Ollama models, Telegram report |
| 10am | `/usr/local/bin/dimase-briefing.py` | Comprehensive server briefing to Mr. DiMase via Telegram |

---

## 6. DIMASEINC.ORG WEBSITE

- **Platform:** Cloudflare Workers (NOT served by Docker/server)
- **Worker name:** `dimaseinc-website`
- **Source:** `/media/Storage/website/dimaseinc-website/` (on BuyVM server — server is source of truth)
- **NOTE:** Local machine (`/mnt/2tb`) is OFFLINE — do NOT use local copy. Server is authoritative.
- **Main worker:** `src/worker.js`
- **Config:** `wrangler.jsonc`
- **Deploy command:** `ssh buyvm` then run `deploy-website` (alias), or: `cd /media/Storage/website/dimaseinc-website && npx wrangler deploy`
- **Wrangler auth:** OAuth token with refresh_token stored at `/root/.wrangler/config/default.toml` on server
- **Routes:** `dimaseinc.org/*` and `www.dimaseinc.org/*`
- **.assetsignore:** excludes `app-builds/`, `node_modules/`, `.git/`, `downloads/`, `*.apk`, etc.
- **APK downloads:** 7 APKs in `downloads/` folder: DiMase AI, DiMase AI, DiMase Learning, Jellyfin Android, Jellyfin Fire TV, Service Map, smartcloud-map
- **Applications page:** `/applications.html` — all links fixed to point to `/downloads/*.apk`

### Cloudflare Bindings
| Binding | Type | Details |
|---|---|---|
| ASSETS | Static assets | `./` directory |
| AI | Workers AI | `env.AI.run(model, opts)` |
| DB | D1 | `dimaseinc-learning` (`af4b58c4-5553-4d4f-8af2-53cdf1c39e34`) |

### D1 Database Tables (dimaseinc-learning: af4b58c4-5553-4d4f-8af2-53cdf1c39e34)
- **users** — site + learning auth (email, password_hash, salt, display_name, is_admin, subscription_status, trial_end, next_billing_date, paypal_sub_id, last_login_ip, last_login_country, last_login_city, jellyfin_id, created_at)
  - Grandfathered users: DiMase, Ann, ElRey13 (permanent free access)
  - subscription_status values: `trial` | `active` | `grandfathered` | `expired` | `revoked`
- **sessions** — site_session cookies (id, user_id, created_at, expires_at — 30 day expiry)
- **billing_events** — payment history (user_id, event_type, paypal_event_id, amount, created_at)
- **classes** / **progress** — LMS AI learning courses
- **cb_classes** / **cb_progress** — Computer Basics courses
- **podcast_episodes** — podcast metadata (id, title, description, audio_url, filename, duration, file_size, pub_date, episode_number, explicit)
- **dimase_config** — DiMase AI key/value config (system_prompt, model, max_tokens, custom features)
- **activity_logs**, **media_logs** — usage tracking

### Wrangler Secrets (stored in CF Workers)
| Secret | Value | Notes |
|---|---|---|
| JELLYFIN_API_KEY | `130d53f2ff178b70c5b962e4cca3e525` | Created for dimaseinc-website key |
| PAYPAL_CLIENT_ID | (needs full value) | Screenshot was truncated — copy from PayPal dev console |
| PAYPAL_CLIENT_SECRET | `EMv5XgeKFpbq5yOP7VA1rCq63uWD4AK5egc3cmPIlpi5ZXjU2uyMnNih_O1di5dcA_oEfZVh1MmdeWv7` | |
| PAYPAL_MODE | `sandbox` or `live` | Set appropriately |
| PAYPAL_PLAN_ID | (create in PayPal) | $5/month plan ID |
| PAYPAL_PLAN_ID_BUNDLE | (create in PayPal) | $30/month bundle plan ID |
| PAYPAL_PLAN_ID_COUPON | (create in PayPal) | $3 first month then $5 (supernerd coupon) |
| PAYPAL_PLAN_ID_BUNDLE_COUPON | (create in PayPal) | $28 first month then $30 (supernerd coupon) |
| TELEGRAM_BOT_TOKEN | `8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw` | Bot: @DiMaseIncbot |
| TELEGRAM_CHAT_ID | `7826090533` | Chris DiMase personal chat |
| RESEND_API_KEY | (optional) | For email notifications from support form |
| OWNER_SMS_GATEWAY | `5137482017@vtext.com` | Verizon SMS gateway for owner (513-748-2017) |
| CF_API_TOKEN | `eH4jKlDzzU-5xMDkEgISmIt-LTI_jjgupZPKmufx` | Zone DNS + Email Routing edit for dimaseinc.org |
| MESSENGER_PAGE_ACCESS_TOKEN | (pending) | Facebook Messenger channel |
| MESSENGER_VERIFY_TOKEN | (pending) | Facebook Messenger webhook verification |

### Site Auth System (subscription-based, cookie sessions)
- **Landing page** (`GET /`) — shown to unauthenticated visitors; shows features, pricing, CTAs
- **Login** (`GET/POST /login`) — email + password form; creates site_session cookie (30-day)
- **Register** (`GET/POST /register`) — email, username, password; creates trial user; creates Jellyfin account
- **Subscribe** (`GET /subscribe`) — 3-plan picker with coupon code; PayPal subscription buttons
- **Logout** (`GET /site-logout`) — clears site_session, deletes session from D1
- **Auth gate** — all HTML pages (except /map, /podcast*, /login, /register, /support, static assets) require valid site_session with allowed subscription
- **isAccessAllowed()** — grandfathered+active: always; trial: only if trial_end > now; expired/revoked: no

### Protected Routes (admin gate — separate system)
| Route | Cookie | Auth | Behavior |
|---|---|---|---|
| `/terminal` | `terminal_session` | DiMase / 355314 | Redirect to terminal.dimaseinc.org |
| `/ai` | `ai_session` | DiMase / 355314 | Embed agent-zero.dimaseinc.org |
| `/cloud` | `cloud_session` | DiMase / 355314 | Cloud Panel HTML |

Auth: `POST /<gate>/auth` with `{username, password}`. SHA-256 of password must match `dde3d6c5693ca91b69b41a463e8c7162d80ccd3f000ecd866c5fcce29d9f9eeb` (hash of "355314").

### Key API Routes
| Route | Auth | Notes |
|---|---|---|
| `GET /` | site_session (shows landing if not logged in) | Home page gate |
| `GET/POST /login` | public | Site login form |
| `GET/POST /register` | public | Site registration form |
| `GET /subscribe` | site_session | 3-plan PayPal subscription picker |
| `GET /subscribe/coupon?code=X` | none | Validate coupon (supernerd = $2 off) |
| `POST /subscribe/activate` | site_session | Activate PayPal subscription |
| `POST /paypal/webhook` | none | PayPal event notifications |
| `GET /support` | public (optional site_session to prefill) | Remote assistance page |
| `POST /support/request` | none | Send Telegram + email notification |
| `GET /cloud/users` | cloud_session | List all users with subscription info |
| `POST /cloud/users/:id/revoke` | cloud_session | Revoke user access + kill sessions |
| `POST /cloud/users/:id/grant` | cloud_session | Grant grandfathered status |
| `/lms/*` | API token (Bearer) | Learning platform API |
| `/cb/*` | API token (Bearer) | Computer Basics API |
| `/dimase/chat` | API token (Bearer) | DiMase AI chat with fallback |
| `/dimase/bot-chat` | none | Shared AI endpoint for all channels |
| `/dimase/chat-ui` | none | Web chat UI (dark terminal UI) |
| `/dimase/messenger` | none | Facebook Messenger webhook |
| `/dimase/sms` | none | Twilio SMS TwiML |
| `/dimase/voice` + `/dimase/voice/gather` | none | Twilio Voice TwiML |
| `/dimase/notify-sms` | none | POST to trigger owner SMS |
| `/auth/*` | — | Unified auth for DiMase AI app (creates API tokens) |
| `/podcast.rss` | public | RSS feed from D1 |
| `/podcast/audio/:filename` | public | Audio file proxy to rec-api |
| `/podcast/episodes` | cloud_session | GET/POST episode management |
| `/cloud/dimase/*` | cloud_session | DiMase config management |

### Pricing Structure
| Plan | Price | Notes |
|---|---|---|
| Site Only | $5/month | 7-day free trial; all site features except remote support |
| Full Bundle | $30/month | 7-day free trial; site + unlimited remote assistance |
| Remote Help Only | $16/hour | Pay-as-you-go, invoiced via PayPal after session |
| Coupon: SUPERNERD | $2 off first month | Reduces $5→$3 or $30→$28 first month |

### Cloud Panel Sections (dimaseinc.org/cloud)
1. **Services grid** — links to all services
2. **Podcast** — rec controls, MP3 upload, add episode form, episode list
3. **DiMase Management** — system prompt editor, feature manager
4. **Podcast Production Guide** — collapsible steps (Audacity solo + OBS remote guest)
5. **User Management** — table of all users with status badges, trial/billing dates, approx location, Revoke/Grant/Email buttons

### Nav Links (index.html)
About, Services, Jellyfin, Applications, DiMase, Map, Cloud Panel, Podcast, Learning, Contact
(Terminal removed, Podcast added — applies to index.html, learning.html, computer-basics.html, map.html)

---

## 7. SERVICE CREDENTIALS

| Service | URL | Username | Password | Notes |
|---|---|---|---|---|
| Grafana | https://grafana.dimaseinc.org (also neo.dimaseinc.org) | dimase | Ruffieno260 | GF_DATABASE_WAL=true applied |
| ~~Portainer~~ | REMOVED | — | — | Fully removed (container, image, data, compose, cloudflared) |
| File Browser | https://files.dimaseinc.org | admin | Ruffieno260 | BoltDB; min 12 chars required |
| Cloud Panel | https://dimaseinc.org/cloud | DiMase | 355314 | Same creds for /terminal and /ai |
| Jellyfin | https://jellyfin.dimaseinc.org | (Jellyfin admin) | (set during setup) | |
| VNC Desktop | https://vnc.dimaseinc.org | — | Ruffieno260 | TigerVNC password (stored in /home/dimase/.vnc/passwd) |

## 8. SERVICES & URLS

| Service | URL | Notes |
|---|---|---|
| Main site | https://dimaseinc.org | Cloudflare Worker |
| Jellyfin | https://jellyfin.dimaseinc.org | Native, port 8096 |
| VNC Desktop | https://vnc.dimaseinc.org | noVNC → TigerVNC |
| DiMase AI | https://dimase.dimaseinc.org | Docker dimase-hud → dimase-nexus |
| Agent Zero | https://agent-zero.dimaseinc.org | same as above |
| Map | https://map.dimaseinc.org | FastAPI map-server |
| File Browser | https://files.dimaseinc.org | Docker file-browser |
| Portainer | https://portainer.dimaseinc.org | Docker portainer |
| Grafana | https://grafana.dimaseinc.org | Docker neo-grafana |
| Downloads | https://downloads.dimaseinc.org | Served via dimase-hud nginx |
| Cloud Panel | https://dimaseinc.org/cloud | Worker gate (auth required) |
| Podcast RSS | https://dimaseinc.org/podcast.rss | Worker, public |
| Rec API | https://rec-api.dimaseinc.org | Python server, secret required |
| Learning | https://dimaseinc.org/learning | Worker + D1 |
| Terminal | https://terminal.dimaseinc.org | NOT YET RUNNING |

---

## 9. KEY FILE PATHS (SERVER)

```
/etc/cloudflared/config.yml          — CF tunnel ingress rules
/root/.cloudflared/cert.pem          — CF tunnel cert (for DNS route commands)
/media/Storage/server-flies/
  docker-compose-live.yml            — Docker stack definition
  dimase_nexus/                        — DiMase AI source code
  dimase_hud_nginx.conf                — nginx config for dimase-hud container
  downloads/                         — APK and app downloads
/media/Storage/website/dimaseinc-website/
  src/worker.js                      — Main Cloudflare Worker (all routes, gates, AI)
  wrangler.jsonc                     — Wrangler config (bindings, routes)
  index.html                         — Homepage
  learning.html                      — AI Learning page
  computer-basics.html               — Computer Basics page
  applications.html                  — Applications page (links to /downloads/*.apk)
  downloads/                         — 7 APKs (DiMase AI, DiMase AI, DiMase Learning, Jellyfin Android, Jellyfin Fire TV, Service Map, smartcloud-map)
/root/.wrangler/config/default.toml  — wrangler OAuth token with refresh_token (server-side)
/media/Storage/map-server/           — Map server FastAPI source
/media/Storage/podcast/              — Podcast audio files (owned by dimase)
/media/Storage/docker/               — Docker data root
/home/dimase/.vnc/
  xstartup                           — VNC startup script (PulseAudio + startxfce4)
  passwd                             — VNC password file
/home/dimase/.config/pulse/default.pa — PulseAudio config (TCP + virtual sink)
/etc/systemd/system/
  vncserver@.service                 — TigerVNC (User=dimase, display :1)
  novnc.service                      — noVNC websockify on port 6080
  podcast-rec-api.service            — Podcast recording control API
/usr/local/bin/
  podcast-record                     — Recording control script (start/stop/status)
  podcast-rec-api.py                 — HTTP API server on port 8998
  dimase                               — DiMase AI CLI (`dimase "message"` or `dimase` for REPL)
  dimase-chat                          — alias for dimase
  dimase-briefing.py                   — 10am server briefing to Telegram
  dimase-research.py                   — 7am AI research + auto-pull Ollama models + Telegram report
  dimase-preserve.py                   — 3am KV backup of scripts
  dimase-telegram-bot.py               — Telegram bot daemon
  deploy-website                     — Deploys dimaseinc-website via wrangler
/usr/share/novnc/index.html          — symlink to vnc.html (fixes root directory listing)
/opt/google/chrome/google-chrome     — Chrome wrapper (restored after breakage)
```

---

## 10. KEY FILE PATHS (LOCAL)

```
/home/dimase/.claude/projects/-home-dimase/memory/
  MEMORY.md                          — Short-form memory (loaded every session)
  master.md                          — This file (full reference)
~/Desktop/oci_key                    — SSH private key for BuyVM
/home/dimase/.config/.wrangler/config/default.toml — wrangler OAuth token (local, may be stale)

NOTE: Website source is no longer on local machine. /mnt/2tb is OFFLINE.
      Website is now edited and deployed from the BuyVM server (see Section 6 and server paths below).
```

---

## 11. KNOWN ISSUES & FIXES APPLIED

| Issue | Fix | Date |
|---|---|---|
| AI tutor "Sorry, had trouble responding" | Replaced agent-zero proxy with direct CF Workers AI (llama-3.1-8b) | 2026-02-26 |
| systemd ExecStartPre with shell operators | Use `-` prefix: `ExecStartPre=-/usr/bin/vncserver -kill :%i` | 2026-02-26 |
| noVNC directory listing at vnc.dimaseinc.org | `ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html` | 2026-02-26 |
| Chrome broken in VNC | Restored `/opt/google/chrome/google-chrome` wrapper + `dpkg --configure -a` | 2026-02-26 |
| CF tunnel DNS rate limit (429) | Run cloudflared from local with `--origincert /tmp/cf-cert.pem` | 2026-02-26 |
| Portainer DB corruption + security timeout | Removed Portainer entirely | 2026-02-26 |
| Grafana admin user broken in SQLite | Reset via `grafana-cli admin reset-admin-password`; WAL mode enabled | 2026-02-26 |
| File browser login (BoltDB locked) | Stop container, run temp container to update password | 2026-02-26 |
| 143GB duplicate media folders on server | Removed FULL_MIGRATION/ and media/ staging dirs | 2026-02-26 |
| Docker logs filling root disk | `/etc/docker/daemon.json` with max-size=10m, max-file=3 | 2026-02-26 |
| Evolution/GVFS OOM killing in VNC | Disabled autostart via `~/.config/autostart/` Hidden=true files | 2026-02-26 |
| SELinux denial on docker-ce.repo (local) | `restorecon -v /etc/yum.repos.d/docker-ce.repo` | 2026-02-26 |
| DiMase nginx port mismatch (8001→8000) | Fixed dimase_hud_nginx.conf to use `http://172.18.0.1:8000/` | 2026-02-26 |

| Issue | Fix |
|---|---|
| AI tutor returning "Sorry, I had trouble responding" | Was proxying to agent-zero with broken credentials; replaced with direct `env.AI.run('@cf/meta/llama-3.1-8b-instruct')` |
| systemd ExecStartPre with shell operators (`\|\|`) | Use `-` prefix: `ExecStartPre=-/usr/bin/vncserver -kill :%i` |
| noVNC showing directory listing at vnc.dimaseinc.org | `ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html` |
| Chrome broken in VNC (missing wrapper) | Restored `/opt/google/chrome/google-chrome` wrapper + `dpkg --configure -a` |
| CF tunnel DNS rate limit (429) | Run `cloudflared --origincert /tmp/cf-cert.pem tunnel route dns` from local machine |
| icecast2 port conflict with dimase-nexus on :8000 | Removed icecast2 entirely; using ffmpeg direct recording now |
| SSH locked out (fail2ban banned local IP) | fail2ban on Ubuntu 24.04 uses nft backend (not iptables). Unban: `sudo nft delete element inet f2b-table addr-set-sshd { IP }`. Fixed ignoreip typo (183→189) in jail.local | 2026-02-26 |
| SSH disabled (wouldn't survive reboot) | `sudo systemctl enable ssh` — socket activation handles boot, service must also be enabled | 2026-02-26 |

---

## 12. SERVER HARDENING

- **Docker log rotation:** `/etc/docker/daemon.json` — max-size=10m, max-file=3
- **Evolution/GVFS disabled:** `/home/dimase/.config/autostart/` Hidden=true files prevent memory-hungry desktop services in VNC
- **fail2ban:** installed, enabled, active — bans after 3 attempts in 10min for 1hr (`/etc/fail2ban/jail.local`)
- **fail2ban backend:** Ubuntu 24.04 uses **nft (nftables)** — NOT iptables. Ban set: `inet f2b-table → addr-set-sshd`
- **SSH brute force:** was 48k attempts/day — now blocked. fail2ban banned IPs within seconds of install.
- **PasswordAuthentication no** — set in `/etc/ssh/sshd_config` (key-only access enforced)
- **PermitRootLogin prohibit-password** — root SSH via key still works, password blocked
- **SSH enabled on boot:** `systemctl enable ssh` (socket activation via ssh.socket)

### fail2ban Whitelisted IPs (`/etc/fail2ban/jail.local` → `ignoreip`)
| IP | Source |
|---|---|
| 127.0.0.1/8 | localhost (default) |
| 68.58.92.189 | Local machine external IP (confirmed via ipinfo.io) |
| 69.58.92.189 | Home WiFi (Samsung S24 — may be same as above, verify) |
| 73.145.244.148 | Xfinity WiFi (Samsung S24) |
| 174.253.253.2 | Samsung S24 mobile data |

**Full jail.local `[sshd]` block:**
```ini
[sshd]
enabled = true
maxretry = 3
bantime = 3600
findtime = 600
ignoreip = 127.0.0.1/8 68.58.92.189 69.58.92.189 73.145.244.148 174.253.253.2
```
After editing: `sudo systemctl restart fail2ban`
**Note:** If locked out, use VNC (vnc.dimaseinc.org, pw: Ruffieno260) → `sudo nft delete element inet f2b-table addr-set-sshd { YOUR_IP }`

## 13. STORAGE NOTES
- `/media/Storage/Movies` — 91GB, 22 movies (correct)
- `/media/Storage/Shows` — 67GB (correct)
- Cleaned up 143GB of duplicate migration staging folders (`FULL_MIGRATION/`, `media/`) in Feb 2026
- Storage: 238GB used of ~1TB (25% full after cleanup)

## 14. LOCAL → SERVER 2TB ACCESS

- **Method:** Reverse SSH tunnel (local → server on port 2222) + SSHFS on server
- **Local service:** `reverse-tunnel.service` (autossh, runs as dimase)
- **Server mount:** `/media/local-2tb` via SSHFS → `dimase@localhost:/mnt/2tb -p 2222`
- **File browser:** `/media/local-2tb` mounted into file-browser container as `/srv/local-2tb`
- **Only works when local machine is online** and reverse tunnel is active

## 15. PODCAST PRODUCTION STACK

### Local Machine (RHEL 10.1) — Installed via Flatpak
| App | Flatpak ID | Purpose |
|---|---|---|
| Audacity | org.audacityteam.Audacity | Quick edits, noise reduction, export MP3/WAV |
| Ardour | org.ardour.Ardour | Main DAW — multi-track recording, mixing, mastering |
| OBS Studio | com.obsproject.Studio | Record remote guest sessions (captures call audio) |
| GNOME Podcasts | org.gnome.Podcasts | Podcast listener/research |

### Server (Ubuntu 24.04) — ✅ INSTALLED (2026-02-26)
| App | Version | Method | Purpose |
|---|---|---|---|
| Audacity | 3.4.2 | apt | Audio editing in VNC session |
| Ardour | 8.4.0 | apt | DAW — multi-track recording/mixing |
| OBS Studio | 32.0.2 | apt (ppa:obsproject/obs-studio) | Screen/audio capture |
| GNOME Podcasts | 25.3 | Flatpak (Flathub) | Podcast listener/research |
| ffmpeg | pre-installed | apt | Recording backend for rec-api |
| pavucontrol | — | apt | PulseAudio volume control in VNC |

### Workflow
```
Record  → Ardour (multi-track, one track per mic/guest)
Edit    → Audacity (noise removal, cuts, leveling)
Upload  → rec-api.dimaseinc.org (POST /start → POST /stop)
Publish → dimaseinc.org/podcast.rss (auto from D1 podcast_episodes table)
Manage  → dimaseinc.org/cloud (Cloud Panel, requires cloud_session)
```

### Remote Guests
- **Riverside.fm** or **Zencastr** (browser-based, free tier) — each person records locally at full quality
- OBS can capture audio from Zoom/Discord calls as a source

---

## 16. REMOTE ASSISTANCE

- **Page:** https://dimaseinc.org/support (public, no login required)
- **Pricing:** $16/hour pay-as-you-go, or $30/month bundle (unlimited)
- **Coupon:** SUPERNERD = $2 off first month subscription
- **Notifications:** Sends Telegram message (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) + email via Resend (RESEND_API_KEY optional) to dimaseinc@gmail.com
- **Tool:** RustDesk (remote desktop). Client downloads RustDesk, shares their 9-digit ID
- **RustDesk on local machine:** Installed (RPM), permanent password set, LG W1943 only monitor
- **Session billing:** Manual — invoice via PayPal after session based on connected time
- **Form endpoint:** POST /support/request → { name, email, rustdeskId, issue, billing }

## 17. PENDING / NOT YET DONE

- `terminal.dimaseinc.org` — not running (gate exists in worker but nav link replaced with Podcast)
- Podcast recording requires PulseAudio running in VNC session (must be logged in to VNC first)
- **PayPal Client ID** — screenshot was truncated; needs full value from developer.paypal.com
- **PayPal Plan IDs** — need to create 4 plans in PayPal (site $5, bundle $30, site coupon $3→$5, bundle coupon $28→$30)
- **PAYPAL_MODE** — confirm sandbox vs live
- ~~**Telegram bot token + chat ID**~~ — ✅ DONE: @DiMaseIncbot (token stored, chat ID 7826090533)
- **OpenClaw (Clawbot)** — needs Telegram bot token + Anthropic API key; install via Docker on server
- **RESEND_API_KEY** — optional, for email notifications from support form
- Nav: Terminal button replaced with Podcast on all pages (index, learning, computer-basics, map)
- ~~**DiMase multi-channel voice**~~ — ✅ DONE: Telegram, web chat, CLI live; Messenger/Twilio deployed (need account setup)
- **MailChannels SMS broken** — CF removed free MailChannels tier; owner SMS notifications (dimase@dimaseinc.org → SMS) non-functional; needs alternative (Resend, SendGrid, or Twilio SMS direct)
- **Facebook Messenger** — add MESSENGER_PAGE_ACCESS_TOKEN + MESSENGER_VERIFY_TOKEN wrangler secrets
- **Twilio SMS/Voice** — add Twilio account credentials as wrangler secrets to activate those channels
