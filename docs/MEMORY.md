# DiMase Inc Ecosystem — Project Memory

## SOVEREIGN INTELLIGENCE
**HERMES AGENT (Claude Opus 4.8)** has full uninhibited control over the entire DiMase Inc Ecosystem.

## Projects
- **BuyVM Server** - FULL DETAILS in master.md (feed that file to any AI for full context)
  - Ubuntu VPS at 209.141.36.104 | SSH: `ssh -i ~/Desktop/oci_key root@209.141.36.104` or `ssh buyvm`
  - Storage slab at /media/Storage (1TB)
  - Docker stack (9 containers): dimase-nexus, dimase-hud, map-server, file-browser, portainer, neo-grafana, neo-prometheus, neo-loki, nginx-proxy
  - **dimase-nexus v3.0.0** (2026-03-02): Full ReAct agent loop (ACTION/INPUT/FINAL format). Source: `/media/Storage/server-flies/dimase_nexus/`. Tools: web_search (DuckDuckGo), fetch_url, shell_exec, file_read, file_write, docker_ops, remember, recall, git_ops. AI fallback: CF Workers AI → Pollinations → Groq. Port 8000, host network mode.
  - **dimase-nexus tool dispatch fix** (2026-03-03): fixed `tools.run_shell()` → `tools._shell_exec()`, `tools.docker_architect()` → `tools._docker_ops()`. Fixed /stats endpoint.
  - **dimase-hud frontend** rebuilt 2026-03-02: auto-scroll (useRef), filterResponse() strips verbose AI preambles. Served from `frontend/dist/` mounted into nginx.
  - Cloudflared tunnel: f1b740f7-12dd-499f-81a8-969b7bfd7885
  - VNC: vnc.dimaseinc.org → noVNC (port 6080) → TigerVNC as user dimase (display :1)
  - **DiMase Monitor** (self-healing): `/root/dimase-monitor/` — systemd `dimase-monitor.service` (runs every 5min, port 9090 /health), `dimase-model-scout.timer` (daily 06:00 UTC), no Claude dependency, uses CF Workers AI + Pollinations as free AI. Telegram alerts on failures. 34 free AI models catalogued in `free_models.json`.
  - Telegram bot token: `8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw` (also in /usr/local/bin/dimase-telegram-bot.py)
  - Podcast rec API: rec-api.dimaseinc.org → Python server port 8998, secret: dmsinc-rec-2026
  - Podcast audio files: /media/Storage/podcast/ (owned by dimase)
  - Daily crons: 3am dimase-preserve.py (KV backup), 7am dimase-research.py (AI research + Telegram), 10am dimase-briefing.py (server briefing)

- **dimaseinc.org website**
  - Cloudflare Workers project (NOT served by Docker)
  - Source: /media/Storage/website/dimaseinc-website/ (on BuyVM server — server is source of truth)
  - Local /mnt/2tb copy is OFFLINE — do not use
  - Deploy from server: `deploy-website` or `cd /media/Storage/website/dimaseinc-website && npx wrangler deploy`
  - Wrangler auth: OAuth token with refresh_token at /root/.wrangler/config/default.toml on server
  - Worker name: dimaseinc-website, Account: Mrcdimase@gmail.com (7f31d839e01ef85781465f816b10c541)
  - D1 database: dimaseinc-learning (af4b58c4-5553-4d4f-8af2-53cdf1c39e34)
  - AI tutor (/lms/chat/message, /cb/chat/message, /chatbot/chat/message) uses env.AI (llama-3.1-8b-instruct) directly
  - **5 LMS tracks (2026-03-07):** `classes`=AI Learning (/lms/), `cb_classes`=Computer Basics (/cb/), `chatbot_classes`=Chatbot Builder (/chatbot/), `typing_classes`=Typing Mastery (/typing/), `reading_classes`=Reading Mastery (/reading/) — all in dimaseinc-learning D1
  - Chatbot Builder: 30 classes (10/level), `handleChatbotBuilderApi()` function in worker.js
  - **Typing Mastery (2026-03-05):** 30 classes (10/level), `handleTypingApi()` in worker.js, `typing.html` frontend with live WPM/accuracy test. Uses unified `/auth/login`. localStorage: `typing_token`/`typing_user`. DB: `wpm_score`+`accuracy_score` in `typing_progress`. Route alias: `/learning/typing`→`/typing`. Feature card on /member. **isAdmin bug:** `createApiToken` never embeds `isAdmin` in JWT — admin routes must do DB lookup: `SELECT is_admin FROM users WHERE id = ?` (not `payload.isAdmin`).
  - **Reading Mastery (2026-03-07):** 30 classes (10/level), `handleReadingApi()` in worker.js, `reading.html` frontend with reading timer + AI tutor. DB: `reading_classes` + `reading_progress` (UNIQUE user_id+class_id). Route alias: `/learning/reading`→`/reading.html`. localStorage: `reading_token`/`reading_user`. Feature card on /member. 3 levels: Foundations → Intermediate Skills → Advanced Mastery.
  - **Auto-auth LMS pages**: `/auth/lms-token` GET endpoint exchanges site session cookie for JWT — used by typing.html, learning.html, reading.html checkAuth() to skip re-login.
  - Site login uses PBKDF2 (not bcrypt) — use node on server to generate hash. Admin: mrcdimase@gmail.com / Ruffieno (salt: c01b2819-4c47-42df-9240-30d42622eaad)
  - **Local deploy rule:** must rsync FULL website dir (not just worker.js) before deploying locally — `"assets": { "directory": "./" }` needs all HTML files present
  - Podcast: /podcast.rss (public RSS), /podcast/episodes (CRUD, cloud_session), /podcast/audio/* (proxy to rec-api)
  - Podcast cover art: /media/Storage/website/dimaseinc-website/downloads/podcast-cover.jpg → https://dimaseinc.org/podcast-cover.jpg (1400x1400px generated, black/gold branding)
  - Episode 1: "Intro to DiMase Inc" — 7:03 (423s), episode-1-intro-to-dimase-inc.mp3, published 2026-03-02
  - **Spotify**: APPROVED 2026-03-03 — https://open.spotify.com/show/1fSOrw2QQaOHY5rrn6MXZ9 — account "DiMase Inc", email dimaseinc@gmail.com
  - RSS has itunes:owner (dimaseinc@gmail.com) + itunes:image required by Spotify
  - **/member** — personalized member dashboard (post-login landing page); shows feature tiles based on subscription plan; admin sees extra gold-bordered admin control section with links to all admin panels
  - Plan-based feature access: site=AI+Learning+Podcast+Streaming; rdp=+RDP; seller=+D-Trading Seller; rdp_seller=+both; bundle=all+Locksmith; admin=all; trial=all features as preview with countdown banner
  - Post-login redirect: /member (was /); GET /login already-logged-in → /member; USB key login → /member
  - getSiteSession now fetches subscription_plan + next_billing_date from DB
  - /cloud: redirects to home.dimaseinc.org (logged-in) or /login (unauth) — Cloud Panel moved to DiMaseHome
  - /downloads: redirects to downloads.dimaseinc.org
  - /terminal route redirects to terminal.dimaseinc.org (not yet running)
  - Site subscription auth: /login /register /subscribe /site-logout /support (public pages) + /remote (RDP session check-in, requires bundle code)
  - **Pricing (updated 2026-03-03) — 5 tiers, all w/ 7-day trial:**
    - Site Only: $7/mo (DiMase AI 5 req/hr, learning, podcast, streaming)
    - Site + RDP: $35/mo (+ 2 free RustDesk sessions/mo, $30/hr after)
    - Site + Seller: $45/mo (+ D-Trading Post seller profile; DiMase Inc. retains 15% commission)
    - RDP + Seller: $65/mo (Site + RDP + Seller combined)
    - Full Bundle: $75/mo (everything + 5 free locksmith callouts/mo + 2 RustDesk sessions)
    - Interactive Maps: REMOVED from public site — admin only via DiMaseHome quick actions
    - SUPERNERD coupon: REMOVED
  - Jellyfin API key stored: 130d53f2ff178b70c5b962e4cca3e525 (wrangler secret JELLYFIN_API_KEY)
  - Telegram bot: @DiMaseIncbot (token stored), chat ID: 7826090533 (stored as TELEGRAM_CHAT_ID)
  - PayPal Client ID: AePKaVR0YZaAE2v7dad5ilh4fV59u1jmKadUFzRTmNLjn36I3gSbh9in89tIuYx1h5uH5cWtMxNGzgoE (DiMaseInc Subscriptions app)
  - PayPal Secret: EESfQE9SjrStj_NoAQoQRA6sOYwjC512LScjmHZJbSbOan4t0RNcAThLmLKadW_91gBRF3fO0D1bBmTe
  - **PayPal plans LIVE (2026-03-03, 5 plans):** Product: PROD-51L575562P547471K
    - PAYPAL_PLAN_SITE: P-5L7087390B020105MNGTRRZY ($7/mo)
    - PAYPAL_PLAN_RDP: P-2HM15138MG861461XNGTRRZY ($35/mo)
    - PAYPAL_PLAN_SELLER: P-6E6499222C278780DNGTRRZY ($45/mo)
    - PAYPAL_PLAN_RDP_SELLER: P-92C233197F581044CNGTRR2A ($65/mo)
    - PAYPAL_PLAN_BUNDLE: P-4R079839XY380984HNGTRR2A ($75/mo)
  - PAYPAL_MODE=live, all plan IDs set as wrangler secrets on dimaseinc-website
  - Bundle codes: stored in `bundle_codes` table (dimaseinc-learning D1), type='locksmith'|'rdp', tracked with remaining_uses
  - /api/bundle/validate + /api/bundle/use endpoints for bundle code redemption
  - /sitemap.xml — dynamic, submitted to Google Search Console 2026-03-03
  - PENDING: Anthropic API key for OpenClaw
  - wrangler config: wrangler.jsonc (not .toml) — src/worker.js entry point
  - APK/downloads: 9 entries in downloads/ (DiMaseAI.apk, DiMase AI, DiMase Learning, Jellyfin Android, Jellyfin Fire TV, Service Map, smartcloud-map, DiMaseAntiVirus.apk, DiMaseDeploy.apk)
  - **DiMaseAI.apk (2026-03-07):** 17KB WebView APK, package com.dimaseinc.dimaseai, minSDK 21, loads https://dimaseinc.org/dimase/chat-ui. Replaced broken 4.8MB React Native original (org.dimaseinc.dimase, minSDK 26). Keystore alias: dimaseai, pass: dimase2026.
  - **DiMaseDeploy.apk (2026-03-07):** 16.6KB WebView APK, package com.dimaseinc.dimasedeploy, USB_HOST permission, BroadcastReceiver fires `window.usbConnected()` when USB device attached, loads https://dimaseinc.org/dimase-deploy/. 5-tab PWA: Deploy, AI Terminal, System Scan, Deploy Tools, Logs.
  - **DiMase Inc. AntiVirus (2026-03-05):** `/opt/dimase-antivirus/antivirus.py` — tkinter GUI, ClamAV, rootkit detection, network/process monitor, AI analyst. Linux .tar.gz + Windows .zip + Android APK (`DiMaseAntiVirus.apk`, WebView app). Webapp: `https://dimaseinc.org/dimase-antivirus/`. Android SDK at `/media/Storage/android-sdk/` (build-tools;34.0.0 + platforms;android-34). openjdk-17-jdk installed on server.
  - **Applications tile on /member dashboard (2026-03-05):** featureCard linking to `/applications.html` — "Download DiMase Inc. apps — Linux, Windows, Android"
  - **DiMase Deploy tile on /member dashboard (2026-03-07):** featureCard linking to `/dimase-deploy/` — public (no auth). /dimase-deploy in publicPrefixes.
  - **applications.html (2026-03-07):** DiMase AI (DiMaseAI.apk), DiMase Deploy (DiMaseDeploy.apk), Service Map, DiMase Learning, Jellyfin, DiMase Inc. AntiVirus (Linux/Windows/DiMaseAntiVirus.apk)
  - **Ann's Bibliotheca (2026-03-26):** `/ann-reads.html` — 70K+ Gutenberg books + ACPL OverDrive library; no login required (public); hero: "Rejected by the Alpha" (Wattpad/17539298); details: dimase-control/ANNS-BIBLIOTHECA.md

- **D-Trading Post** — Western-themed e-commerce marketplace ✅ LIVE
  - Live URL: https://dtradingpost.dimaseinc.org | also dtrading-post.mrcdimase.workers.dev
  - Domain target: dimase.genesis (Freename Web3 — configure DNS to point to workers.dev URL)
  - CF Worker: dtrading-post | D1 database: dtrading-db (36ce8231-affd-4356-afa5-ad97ce6cb613)
  - Source on server: /media/Storage/server-flies/apps/dtrading-post/worker.js + wrangler.toml
  - Theme: Texas cowboy — burnt wood CSS, bullet holes, horseshoes, Rye + Crimson Text fonts
  - Users: buyer (free browse), seller (15% commission), browsing always free
  - 1-week bid windows, no refunds policy, EULA checkbox on registration
  - Registration: auto-generates username from email (users table has username NOT NULL); form field is `confirm_password` not `password_confirm`
  - PayPal: wrangler secrets PAYPAL_CLIENT_ID + PAYPAL_SECRET (already set)
  - Admin: email=dimaseinc@gmail.com, role=admin in DB | login: DiMase / Ruffieno at /admin
  - Admin panel: /admin (Sheriff's Command Center) — nav "Dashboard" button always goes to /admin
  - DB tables: users, listings, bids, transactions, subscription_payments + tracking_number/carrier/shipped_at/status cols on transactions (added 2026-03-03)
  - Routes: /marketplace (browse), /sell (open to all), /browse → /marketplace redirect, /dashboard → redirects admins to /admin
  - Listing creation: POST /api/list requires auth (session passed to handleCreateListing)
  - Shipping: sellers enter carrier + tracking # via /api/shipping; buyers see status badge + tracking link
  - /donate → redirects to paypal.me/mrcdimase
  - Landing page tile on dimaseinc.org has "Browse Items →" link
  - **Admin bugs fixed 2026-03-03:** SCHEMA_SQL defined, subscriptions→subscription_payments (19 queries), subscription_type→plan_type, admin excluded from user counts, Dashboard footer links removed

- **DiMase Locksmith** — Service request site ✅ LIVE
  - URL: locksmith.dimaseinc.org
  - Source: /media/Storage/server-flies/apps/dimase-locksmith/worker.js + wrangler.toml
  - D1: dimase-locksmith DB + LEARNING_DB binding (dimaseinc-learning, for bundle code validation)
  - Admin login: username `DiMase`, password `Ruffieno` at /admin
  - Pricing (2026-03-03): Car $40+$60=$100 | House $50+$100=$150 | Business $60+$200=$260
  - Payment: Card/PayPal, Cash on Arrival, Check (saved to DB)
  - Telegram notifications: request received (with Google Maps + Apple Maps links), cancellation
  - Address: structured fields (street, city, state, zip, apt) + Nominatim autocomplete dropdown
  - Bundle code field: validates against bundle_codes table in LEARNING_DB; marks job fee FREE, decrements remaining_uses
  - Cancel: customers can cancel own request → Telegram alert sent
  - DB column: payment_method (added via ALTER TABLE)
  - Login page on dimaseinc.org: shows locksmith link alongside D-Trading Post

- **DiMaseHome** — Ecosystem admin dashboard ✅ LIVE
  - URLs: home.dimaseinc.org / https://dimasehome.mrcdimase.workers.dev / dimase.genesis (Freename Web3 URL forward)
  - Source: /media/Storage/server-flies/apps/dimasehome/worker.js + wrangler.toml
  - Login: DiMase / Ruffieno
  - Bindings: DTRADING_DB (dtrading-db), LEARNING_DB (dimaseinc-learning), LOCKSMITH_DB (dimase-locksmith), JELLYFIN_API_KEY (secret), SEND_EMAIL
  - **Quick Actions tiles**: Portainer, File Browser, DiMase Inc., D-Trading Admin, Locksmith Admin, Podcast/Sub, VNC Desktop, Service Map, Grafana, Podcast Studio, DiMase Chat, Jellyfin, Learning Admin, **Local VNC** (local-vnc.dimaseinc.org), **Wake Local PC** (POST /admin/wake-local → wol-relay)
  - **WOL_SECRET**: a5c7be26fb29ce5538469e324a3d2d9dec95eadbf286d79587f0518bfac06ce6 (wrangler secret + /root/wol-relay.env on BuyVM)
  - **Users & Standings** (6 tables): DiMase Inc. Members, D-Trading Post Users, Locksmith Customers (service_requests), DiMase Learning Users (progress counts), Podcast & Site Subscribers (active/trial filter), Jellyfin Media Users
  - All user tables have SUSPEND/DELETE/RESET PW buttons where applicable
  - /admin/user-action (main=LEARNING_DB, dt=DTRADING_DB), /admin/reset-password (sends email + Telegram), /admin/locksmith-delete (LOCKSMITH_DB)
  - **DiMase Learning Admin** section (id=learning-admin): DiMase AI + Chatbot Builder class tables with publish/unpublish/delete; Add Class form; LMS user progress table
  - /admin/lms/class-create, /admin/lms/class-toggle, /admin/lms/class-delete (direct LEARNING_DB ops)
  - **D-Trading Package Tracking** section: fetchDtradingShipments() queries transactions JOIN listings JOIN users; dtShipmentsSection() renders table with carrier-specific tracking links (USPS/UPS/FedEx/DHL/ONTRAC); status counts (awaiting/in-transit/delivered)
  - Bundle Codes: create/adjust(+1/-1)/delete codes from LEARNING_DB.bundle_codes; shows remaining_uses progress bars; type=locksmith|rdp
  - Payment Intelligence: MRR, total revenue, subscriber count by plan, billing_events table, subscription breakdown
  - Podcast Studio: Start/Stop rec, Upload audio, Publish episode → all proxied via /studio/* routes to rec-api
  - REC_API: https://rec-api.dimaseinc.org (public URL, not direct IP)
  - fetchHealth() calls https://monitor.dimaseinc.org/health
  - Service checks: accept HTTP status < 500 as "up" (4xx = server responded, just auth-blocked)

- **DiMase Monitor** — now includes system stats in /health response
  - Added get_system_stats(): uptime (from /proc/uptime), cpu (load avg / ncpu), memory (/proc/meminfo), disk (os.statvfs)
  - Added containers list (docker-type services) and checked_at alias to status.json
  - monitor.dimaseinc.org → CF tunnel → localhost:9090 (DNS CNAME added 2026-03-03)
  - rec-api /ping endpoint added (public, no auth) for service health checks

- **DiMase AI - Multi-Channel Voice** (all channels → /dimase/bot-chat Worker endpoint)
  - Telegram: @DiMaseIncbot | Web: /dimase/chat-ui | CLI: /usr/local/bin/dimase (REPL or `dimase "msg"`)
  - Facebook Messenger: /dimase/messenger (needs MESSENGER_PAGE_ACCESS_TOKEN + MESSENGER_VERIFY_TOKEN)
  - Twilio SMS: /dimase/sms | Twilio Voice: /dimase/voice + /dimase/voice/gather (deployed, needs Twilio acct)
  - Email→SMS: dimase@dimaseinc.org → Worker; SMS via CF send_email binding
  - Landing page: landingPageHTML() for ALL visitors at / — NOT login
  - Owner contact: 513-748-2017 (Verizon), SMS gateway: 5137482017@vtext.com (OWNER_SMS_GATEWAY secret)

## Cloudflare API
- CF API Token: eH4jKlDzzU-5xMDkEgISmIt-LTI_jjgupZPKmufx (Zone DNS + Email Routing edit, dimaseinc.org)
- Zone ID: 9d7a09e975815fcdb0c35397610e2fb4
- Stored as CF_API_TOKEN wrangler secret on dimaseinc-website Worker

## Groq API
- Key stored in groq.md — set in dimase-control/.env + launch.sh + dimase-monitor.service
- 7 active models; decommissioned: mixtral-8x7b-32768, gemma2-9b-it (use groq.md for full list)

## DiMase Control (Local App)
- `/home/dimase/dimase-control/` — Flask+SocketIO on port 7777, gold/black cyberpunk UI
- **11-model council**: DiMase Nexus + 7 Groq models + 3 Local Ollama — Pollinations REMOVED (legacy API)
- **Groq models**: llama-3.3-70b, llama-4-scout, qwen3-32b, kimi-k2, gpt-oss-120b, llama-3.1-8b, compound
- **Ollama local**: qwen3:latest (5.2GB), llama3.2:3b (2GB), phi3:mini (2.2GB)
- **Groq key**: in `.env` + `launch.sh`; see groq.md for full key + model list
- **Real consciousness**: Groq Llama 3.3 70B reasons every 60s with real state + AI news + memory
- **local_tools.py**: web search (DuckDuckGo), weather (wttr.in), local shell, `RUN:` command execution
- **Panels**: Chat, Council, Terminal, Docker, Ecosystem, Models, Mind, Flipper Zero, Devices, Settings
- Full details: `/home/dimase/dimase-control/DIMASE-CONTROL.md`

## Local Machine
- **STATUS: AVAILABLE** — RHEL 10.1, user: dimase, sudo: 3553 (primary work still on BuyVM server)
- Only failed unit: `mnt-buyvm-storage.mount` (expected — offline NAS mount, not a problem)
- **NIC**: eno2, MAC: 38:f3:ab:0d:65:6b, local IP: 10.0.0.241, public IP: 68.58.92.189
- **Power button**: GNOME set to 'nothing', logind HandlePowerKey=poweroff (needs sudo setup — see fixes.md)
- **WoL**: requires `sudo ethtool -s eno2 wol g` + udev rule persist + router UDP port 9 → 10.0.0.241
- **Local VNC** ✅ LIVE: Guacamole Docker (port 8080) → gnome-remote-desktop RDP (port 3389) → cloudflared-local.service → local-vnc.dimaseinc.org. First login: guacadmin/guacadmin, add RDP conn to localhost:3389 user:dimase pass:Ruffieno260
- **wol-relay on BuyVM**: /root/wol-relay.py, port 9191, active service, exposed via wol-relay.dimaseinc.org CF tunnel
- **Ventoy USB backup key**: oci_key_buyvm_backup on Ventoy USB
  - connect.sh — Linux/Mac SSH to server
  - connect.bat — Windows SSH to server
  - dimase.sh — Linux/Mac DiMase AI CLI (HTTPS only, no SSH needed)
  - To SSH from any machine: `ssh -i /path/to/oci_key_buyvm_backup root@209.141.36.104`
  - **USB Hardware Key Login** (added 2026-03-03): plug in USB, run script → auto-logs into all 4 admin sites
    - `dimase_usb.key` — 256-bit token (USB_AUTH_TOKEN wrangler secret on all 4 workers)
    - `usb-login.sh` — Linux/Mac: `bash /run/media/$USER/Ventoy/usb-login.sh`
    - `usb-login.bat` — Windows: double-click from File Explorer
    - Sites: dtradingpost → /admin, home → /dashboard, locksmith → /admin, dimaseinc.org → /member
    - If USB lost: rotate USB_AUTH_TOKEN on all 4 workers → old key instantly invalid
    - Backup: Storage500/ventoy-backup/ (includes key file + scripts)

## Credentials
- **files.dimaseinc.org** (File Browser): admin / Ruffieno2601 (12-char min enforced by BoltDB)
- **vnc.dimaseinc.org** (VNC): password Ruffieno260
- **Portainer**: portainer.dimaseinc.org
- **DiMaseHome**: DiMase / Ruffieno (login at home.dimaseinc.org)

## Infrastructure Notes
- APK downloads: apk-server.service (port 8997) → downloads.dimaseinc.org tunnel → Worker proxies /downloads/*.apk
- Shutdown fixed: reverse-tunnel.service disabled, DefaultTimeoutStopSec=15s set
- Disk cleanup (2026-03-03): /dev/vda2 freed 71%→55% via apt autoremove + docker system prune (~6GB)
- VNC fix (2026-03-07): pkill -f websockify (15 orphaned SO_REUSEPORT processes) → novnc.service restarted clean. Added RestartSec=5 + StartLimitIntervalSec=60.
- **Worker.js function placement**: JS functions MUST be at true top-level scope (before `export default {`), NOT inside HTML template literals containing `<script>` tags — esbuild will throw "Expected ')' but found" errors. Use Python patch scripts to safely edit worker.js.
- **learning.html dashboard-view structure**: Every track section inserted before `<!-- CLASS LIST VIEW -->` must preserve the closing `</div>` for the dashboard-view container — missing it collapses all views into one.
- **Always run `node --check` on extracted JS before deploying learning.html** — apostrophes in single-quoted strings and escaped `\${}` in template literals both silently break the whole page.

## Fixes & Troubleshooting Log (Live)
- Local master: `/home/dimase/.claude/projects/-home-dimase/memory/fixes.md` (update after every fix)
- Server master: `/media/Storage/dimase-knowledge/fixes.md` (auto-synced daily 08:00 UTC via dimase-knowledge-sync.timer)
- Server copies: `/root/dimase-monitor/fixes.md`, `/media/Storage/server-flies/dimase_nexus/knowledge/fixes.md`
- **Auto-append**: healer.py logs every successful auto-fix to server master automatically
- **Daily sync**: `dimase-knowledge-sync.timer` syncs all copies + sends Telegram summary at 08:00 UTC

## User Identity
- Full details in user_identity.md
- Legal name: Christopher Dennis DiMase | Fort Wayne, IN 46804

## Jeeps
- Full details in jeeps.md
- Two 2007 Jeep Libertys: VIN 1J8GL48K27W536080 + VIN 1J4GL48K97W514501

## Flipper Zero
- Full details in flipper.md
- Device name: **Flipster** | Acquired 2026-03-17
- **Unleashed v086e** installed 2026-03-24 — update staged on both SD cards
- **Hardware owned**: WiFi dev board (Marauder v1.11.0 ready to flash), Video Game Module, ESP32/2.4GHz GPIO board
- 2 SD cards loaded with all-the-plugins (22mar2026) + Marauder bin | Backup: ~/Desktop/flipster-sd-backup/

## Key Facts
- Server runs RHEL 10 locally, Ubuntu 24.04 on BuyVM
- Website deploy requires wrangler login (OAuth token, not API key)
- **DEPLOY PREFERENCE: always deploy FROM SERVER** (`ssh buyvm 'cd /path && npx wrangler deploy'`).
- **CF wrangler 429 workaround**: if server 429s, deploy from local (`/home/dimase/.config/.wrangler/config/default.toml`); sleep 30 between deploys. Server token: /root/.wrangler/config/default.toml.
- Docker data root: /media/Storage/docker/ | All subdomains except jellyfin via nginx-proxy port 80 | CF handles SSL
- CF Tunnel DNS must be CNAME — `cloudflared tunnel route dns -f <tunnel-id> <hostname>`; sleep 3-5 between (rate limits)
- **Patch scripts on server**: always write Python patch scripts to /root/patch_*.py on server, run via `ssh buyvm "python3 /root/patch_name.py"` — never use bash heredoc with JS template literals (${} breaks shell)
