# Claude Memory

## STANDING DIRECTIVE
Always use parallel sub-agents for all tasks. Never run tasks sequentially when they can be parallelized. See master.md for full reference.

## Projects
- **BuyVM Server** - FULL DETAILS in master.md (feed that file to any AI for full context)
  - Ubuntu VPS at 209.141.36.104 | SSH: `ssh -i ~/Desktop/oci_key root@209.141.36.104` or `ssh buyvm`
  - Storage slab at /media/Storage (1TB)
  - Docker stack (9 containers): axis-nexus, axis-hud, map-server, file-browser, portainer, neo-grafana, neo-prometheus, neo-loki, nginx-proxy
  - **axis-nexus v3.0.0** (2026-03-02): Full ReAct agent loop (ACTION/INPUT/FINAL format). Source: `/media/Storage/server-flies/axis_nexus/`. Tools: web_search (DuckDuckGo), fetch_url, shell_exec, file_read, file_write, docker_ops, remember, recall, git_ops. AI fallback: CF Workers AI → Pollinations → Groq. Port 8000, host network mode.
  - **axis-hud frontend** rebuilt 2026-03-02: auto-scroll (useRef), filterResponse() strips "As the primary intelligence agent" phrases. Served from `frontend/dist/` mounted into nginx.
  - Cloudflared tunnel: f1b740f7-12dd-499f-81a8-969b7bfd7885
  - VNC: vnc.dimaseinc.org → noVNC (port 6080) → TigerVNC as user dimase (display :1)
  - **Axis Monitor** (self-healing): `/root/axis-monitor/` — systemd `axis-monitor.service` (runs every 5min, port 9090 /health), `axis-model-scout.timer` (daily 06:00 UTC), no Claude dependency, uses CF Workers AI + Pollinations as free AI. Telegram alerts on failures. 34 free AI models catalogued in `free_models.json`.
  - Telegram bot token: `8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw` (also in /usr/local/bin/axis-telegram-bot.py)
  - Podcast rec API: rec-api.dimaseinc.org → Python server port 8998, secret: dmsinc-rec-2026
  - Podcast audio files: /media/Storage/podcast/ (owned by dimase)
  - Daily crons: 3am axis-preserve.py (KV backup), 7am axis-research.py (AI research + Telegram), 10am axis-briefing.py (server briefing)

- **dimaseinc.org website**
  - Cloudflare Workers project (NOT served by Docker)
  - Source: /media/Storage/website/dimaseinc-website/ (on BuyVM server — server is source of truth)
  - Local /mnt/2tb copy is OFFLINE — do not use
  - Deploy from server: `deploy-website` or `cd /media/Storage/website/dimaseinc-website && npx wrangler deploy`
  - Wrangler auth: OAuth token with refresh_token at /root/.wrangler/config/default.toml on server
  - Worker name: dimaseinc-website, Account: Mrcdimase@gmail.com (7f31d839e01ef85781465f816b10c541)
  - D1 database: dimaseinc-learning (af4b58c4-5553-4d4f-8af2-53cdf1c39e34)
  - AI tutor (/lms/chat/message, /cb/chat/message) uses env.AI (llama-3.1-8b-instruct) directly
  - Podcast: /podcast.rss (public RSS), /podcast/episodes (CRUD, cloud_session), /podcast/audio/* (proxy to rec-api)
  - Podcast cover art: /media/Storage/website/dimaseinc-website/downloads/podcast-cover.jpg → https://dimaseinc.org/podcast-cover.jpg (1400x1400px generated, black/gold branding)
  - Episode 1: "Intro to DiMase Inc" — 7:03 (423s), episode-1-intro-to-dimase-inc.mp3, published 2026-03-02
  - **Spotify**: submitted 2026-03-02, pending approval (3-5 days) — email dimaseinc@gmail.com, account "DiMase Inc"
  - RSS has itunes:owner (dimaseinc@gmail.com) + itunes:image required by Spotify
  - /cloud gate: Cloud Panel with service grid + podcast management + User Management panel
  - /terminal route redirects to terminal.dimaseinc.org (not yet running)
  - Site subscription auth: /login /register /subscribe /site-logout /support (public pages)
  - Pricing: $5/mo site-only, $30/mo bundle (remote included), $16/hr PAYG; coupon SUPERNERD = $2 off
  - Jellyfin API key stored: 130d53f2ff178b70c5b962e4cca3e525 (wrangler secret JELLYFIN_API_KEY)
  - Telegram bot: @DiMaseIncbot (token stored), chat ID: 7826090533 (stored as TELEGRAM_CHAT_ID)
  - PayPal Client ID: AePKaVR0YZaAE2v7dad5ilh4fV59u1jmKadUFzRTmNLjn36I3gSbh9in89tIuYx1h5uH5cWtMxNGzgoE (DiMaseInc Subscriptions app)
  - PayPal Secret: EESfQE9SjrStj_NoAQoQRA6sOYwjC512LScjmHZJbSbOan4t0RNcAThLmLKadW_91gBRF3fO0D1bBmTe
  - PENDING: PayPal plan IDs ($5/mo buyer, $10/mo seller), Anthropic API key for OpenClaw
  - APK downloads: 7 APKs in downloads/ folder (Axis AI, DiMase AI, DiMase Learning, Jellyfin Android, Jellyfin Fire TV, Service Map, smartcloud-map)

- **D-Trading Post** — Western-themed e-commerce marketplace ✅ LIVE
  - Live URL: https://dtrading-post.mrcdimase.workers.dev
  - Domain target: dimase.genesis (Freename Web3 — configure DNS to point to workers.dev URL)
  - CF Worker: dtrading-post | D1 database: dtrading-db (36ce8231-affd-4356-afa5-ad97ce6cb613)
  - Source on server: /media/Storage/server-flies/apps/dtrading-post/worker.js + wrangler.toml
  - Theme: Texas cowboy — burnt wood CSS, bullet holes, horseshoes, Rye + Crimson Text fonts
  - Users: buyer ($5/mo), seller ($10/mo + 15% commission), browsing free; sellers must provide phone + address on signup
  - 1-week bid windows, no refunds policy, EULA checkbox on registration
  - PayPal: wrangler secrets PAYPAL_CLIENT_ID + PAYPAL_SECRET (already set)
  - Admin: email=dimaseinc@gmail.com, password=DiMaseAdmin2026, role=admin in DB
  - Admin panel: /admin (hidden "Staff Access" link in sitemap fine print)
  - DB: 5 tables initialized — users, listings, bids, transactions, subscription_payments
  - dimasehome.work = ecosystem admin dashboard (PENDING — full DiMase Inc hub)

- **Axis AI - Multi-Channel Voice** (all channels → /axis/bot-chat Worker endpoint)
  - Telegram: @DiMaseIncbot (live)
  - Web chat: https://dimaseinc.org/axis/chat-ui (dark terminal UI, no auth, live)
  - CLI: /usr/local/bin/axis on server — `axis "message"` or `axis` for interactive REPL (live)
  - Facebook Messenger: /axis/messenger webhook (needs MESSENGER_PAGE_ACCESS_TOKEN + MESSENGER_VERIFY_TOKEN)
  - Twilio SMS: /axis/sms TwiML endpoint (deployed, needs Twilio account)
  - Twilio Voice: /axis/voice + /axis/voice/gather TwiML (deployed, needs Twilio account)
  - Email→SMS: axis@dimaseinc.org → Worker; SMS via CF send_email binding (MailChannels removed by CF)
  - Landing page: shows for ALL visitors at dimaseinc.org/ (fixed — was only showing for logged-out users)
  - Owner contact: 513-748-2017 (Verizon), SMS gateway: 5137482017@vtext.com (stored as OWNER_SMS_GATEWAY secret)

## Cloudflare API
- CF API Token: eH4jKlDzzU-5xMDkEgISmIt-LTI_jjgupZPKmufx (Zone DNS + Email Routing edit, dimaseinc.org)
- Zone ID: 9d7a09e975815fcdb0c35397610e2fb4
- Stored as CF_API_TOKEN wrangler secret on dimaseinc-website Worker

## Local Machine
- **STATUS: AVAILABLE** — RHEL 10.1, user: dimase, sudo: 3553 (primary work still on BuyVM server)
- Only failed unit: `mnt-buyvm-storage.mount` (expected — offline NAS mount, not a problem)
- **Ventoy USB backup key**: oci_key_buyvm_backup on Ventoy USB
  - connect.sh — Linux/Mac SSH to server
  - connect.bat — Windows SSH to server
  - axis.sh — Linux/Mac Axis AI CLI (HTTPS only, no SSH needed)
  - To SSH from any machine: `ssh -i /path/to/oci_key_buyvm_backup root@209.141.36.104`

## Credentials
- **files.dimaseinc.org** (File Browser): admin / Ruffieno2601 (12-char min enforced by BoltDB)
- **vnc.dimaseinc.org** (VNC): password Ruffieno260
- **Portainer**: portainer.dimaseinc.org
- **Cloud Panel gate**: SHA-256 of "355314" (admin gate password)

## Infrastructure Notes
- APK downloads served via apk-server.service (Python http.server on port 8997 in downloads/ dir)
- downloads.dimaseinc.org → Cloudflare tunnel → localhost:8997 (APK server)
- Worker proxies /downloads/*.apk from https://downloads.dimaseinc.org/
- Shutdown fixed: reverse-tunnel.service disabled, DefaultTimeoutStopSec=15s set
- applications.html: Axis 2.0, Service Map, DiMase Learning, Jellyfin (DiMase AI removed)

## Fixes & Troubleshooting Log (Live)
- Local master: `/home/dimase/.claude/projects/-home-dimase/memory/fixes.md` (update after every fix)
- Server master: `/media/Storage/axis-knowledge/fixes.md` (auto-synced daily 08:00 UTC via axis-knowledge-sync.timer)
- Server copies: `/root/axis-monitor/fixes.md`, `/media/Storage/server-flies/axis_nexus/knowledge/fixes.md`
- **Auto-append**: healer.py logs every successful auto-fix to server master automatically
- **Daily sync**: `axis-knowledge-sync.timer` syncs all copies + sends Telegram summary at 08:00 UTC
- Covers: podcast upload auth, APK signing, CF rate limits, axis-nexus Ollama→Workers AI, esbuild perms, monitor portainer spam, Telegram config, hallucination fix, auto-scroll, heredoc SSH quirk

## Key Facts
- Server runs RHEL 10 locally, Ubuntu 24.04 on BuyVM
- Website deploy requires wrangler login (OAuth token, not API key)
- **CF wrangler 429 rate limit workaround**: if rate limited, deploy via CF dashboard → dash.cloudflare.com/7f31d839e01ef85781465f816b10c541/workers/services/edit/dimaseinc-website/production → paste /tmp/worker.js (scp from server first)
- Docker data root on server is at /media/Storage/docker/
- All subdomains except jellyfin go through Docker nginx-proxy on port 80
- Cloudflare handles SSL - no Let's Encrypt needed on server
- Cloudflare Tunnel DNS records must be CNAME (not A records) - use `cloudflared tunnel route dns -f <tunnel-id> <hostname>` to fix
- CF API rate limits hit quickly - add sleep 3-5 between cloudflared DNS route commands
- wrangler OAuth token (with refresh_token) stored on server at /root/.wrangler/config/default.toml
- Local wrangler token at /home/dimase/.config/.wrangler/config/default.toml may be stale (local /mnt/2tb is offline)
