# DiMase Inc — Documented Fixes & Solutions
> Training reference: each entry includes root cause, symptom, and exact fix.
> Updated: 2026-03-02

---

## Cloudflare Worker: Podcast Upload "Unauthorized"
**Symptom:** Clicking "Upload to Server" in Cloud Panel → red "✗ Unauthorized" message
**Root cause:** `fetch('/podcast/upload', {...})` in `uploadEpisodeFile()` did not include `credentials: 'include'`. Browsers do not send cookies by default on `fetch()`, so the `cloud_session` cookie was never sent to the Worker. The Worker's auth gate at line 2032 saw no cookie and returned 401.
**Fix:** Added `credentials: 'include'` to the fetch call in `worker.js` line ~3056.
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js`
**Session expiry note:** `cloud_session` token expires after 1 hour (`Date.now() - token.ts > 3600000`). If Unauthorized appears again, re-login at `/cloud`.

---

## dimase-model-scout.service: ModuleNotFoundError httpx
**Symptom:** `systemctl status dimase-model-scout.service` shows `ModuleNotFoundError: No module named 'httpx'`
**Root cause:** `httpx` was installed via pip but the service ran before installation completed, OR pip install was done without `--break-system-packages` on Ubuntu 24.04 (PEP 668 protection).
**Fix:** `pip3 install httpx --break-system-packages` (httpx 0.28.1 installs to `/usr/local/lib/python3.12/dist-packages/`). Script then ran cleanly — 29 free models catalogued, Telegram notified.
**File:** `/root/dimase-monitor/model_scout.py`

---

## dimase-monitor: Portainer Healer Spam
**Symptom:** dimase-monitor logs showed healer hitting 2/3 retry attempts every 300s trying to restart "portainer" — `docker restart portainer` → "No such container"; `docker compose up portainer` → "no such service: portainer"
**Root cause:** "portainer" was listed in `DOCKER_CONTAINERS` in monitor.py and in `config.json` under `services.http`, but portainer is NOT a container in `docker-compose-live.yml`. It runs outside Docker compose (accessible at portainer.dimaseinc.org but managed separately).
**Fix:** Removed "portainer" from `DOCKER_CONTAINERS` in `monitor.py` and from `services.http` in `config.json`. Monitor now reports 18/18 healthy.
**Files:** `/root/dimase-monitor/monitor.py`, `/root/dimase-monitor/config.json`

---

## dimase-hud Frontend: esbuild EACCES Permission Denied
**Symptom:** `npx vite build` failed with `spawn .../node_modules/@esbuild/linux-x64/bin/esbuild EACCES`
**Root cause:** esbuild binary lost execute permission (likely from a file copy or mount operation that stripped execute bits).
**Fix:** `chmod +x /media/Storage/server-flies/apps/dimase-2.0/frontend/node_modules/@esbuild/linux-x64/bin/esbuild` then `chmod -R +x node_modules/.bin/`. Build succeeded (304.94 kB JS, 11.61s). Note: `frontend/dist/` is directly mounted into the dimase-hud nginx container — no copy needed after build.
**File:** `/media/Storage/server-flies/apps/dimase-2.0/frontend/`

---

## dimase-nexus: "Inference Error: All connection attempts failed"
**Symptom:** https://dimase.dimaseinc.org chat showed "Inference Error: All connection attempts failed" on every message
**Root cause:** `nexus.py` was hardcoded to call Ollama at `localhost:11434`, but Ollama is NOT installed on the BuyVM VPS.
**Fix:** Replaced all Ollama calls with `https://dimaseinc.org/dimase/bot-chat` (CF Workers AI endpoint). Also fixed port `8001 → 8000` mismatch between `nexus.py` main() and Dockerfile EXPOSE + nginx proxy config.
**Version:** dimase-nexus rebuilt as v3.0.0 with full ReAct agent loop.
**File:** `/media/Storage/server-flies/dimase_nexus/nexus.py`

---

## dimase-nexus v3.0.0: ReAct Agent Loop
**What was added:** Full agentic tool-use loop using ACTION/INPUT/FINAL text format (works with any LLM — no function calling API needed).
**Tools available:** web_search (DuckDuckGo dual-API), fetch_url, shell_exec, file_read, file_write, docker_ops, remember (ChromaDB), recall (ChromaDB similarity), git_ops
**AI fallback chain:** CF Workers AI (bot-chat) → Pollinations.ai (free GET API) → Groq (if key set)
**Safety:** shell_exec has blocklist for destructive commands; file paths whitelist enforced
**Files:** `/media/Storage/server-flies/dimase_nexus/nexus.py`, `/media/Storage/server-flies/dimase_nexus/tool_controller.py`

---

## DiMase AI: Hallucination / Fabricating Facts
**Symptom:** DiMase answered questions about current weather with made-up data, gave wrong info about Claude architecture
**Root cause:** System prompt contained "never vague or generic" and "answer with actual information" — this pressured the model to invent plausible-sounding answers rather than admit uncertainty.
**Fix:** Replaced with: "You do NOT have access to real-time data (no live weather, news, stock prices, or current events) — say so clearly when asked. Never invent specific facts or technical details you cannot verify."
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js` (system prompt section)

---

## DiMase AI Chat: "As the primary intelligence agent of DiMase Inc.,"
**Symptom:** Every response from dimase.dimaseinc.org started with "As the primary intelligence agent of DiMase Inc.," — repetitive, robotic
**Root cause:** System prompt phrasing caused the model to use this as a framing opener for every reply.
**Fix (frontend):** Added `filterResponse()` function to `App.jsx` that strips the phrase and common variants via regex before rendering.
**Fix (backend):** System prompt updated to explicitly say not to use this opener.
**File:** `/media/Storage/server-flies/apps/dimase-2.0/frontend/src/App.jsx`

---

## dimase-hud: Auto-Scroll Missing
**Symptom:** New messages in dimase.dimaseinc.org chat panel did not scroll into view automatically
**Fix:** Added `useRef` scroll anchor to `App.jsx`: `const messagesEndRef = useRef(null)` + `useEffect` watching `[messages, isProcessing]` + `<div ref={messagesEndRef} />` at bottom of message list.
**File:** `/media/Storage/server-flies/apps/dimase-2.0/frontend/src/App.jsx`

---

## APK Installation Failure (V1-only Signature)
**Symptom:** DiMase 2.0 APK downloaded but Android refused to install ("App not installed")
**Root cause:** `jarsigner` only produces V1 (JAR) signatures. Modern Android requires V2 or V3 APK signatures.
**Fix:** Re-signed with `uber-apk-signer.jar` which adds V2+V3 signatures automatically.
**Command:** `java -jar /tmp/uber-apk-signer.jar -a dimase-2.0-signed.apk --allowResign --ks /home/dimase/dimaseinc-release.jks --ksAlias dimaseinc-release --ksPass DiMaseInc2026 --ksKeyPass DiMaseInc2026 --skipZipAlign`
**Also required:** Users must uninstall old DiMase AI first if certificate changed (Android blocks signature downgrades).

---

## Cloudflare CDN Serving Stale APK
**Symptom:** Server had updated APK but downloads.dimaseinc.org still served old version (max-age=14400)
**Root cause:** Cloudflare CDN cached the APK file. CF API token only has DNS + Email Routing scope — cannot call cache purge API.
**Fix:** Added `?v=2` to download URL in `applications.html`. Updated Worker to pass `url.search` to the origin: `const serverUrl = 'https://downloads.dimaseinc.org/' + filename + (url.search || '')`.

---

## Cloudflare Wrangler Deploy Rate Limit (429 / error 1015)
**Symptom:** `npx wrangler deploy` returns `429 Too Many Requests` or Cloudflare error 1015
**Root cause:** Wrangler makes a GET pre-flight check to `/accounts/.../workers/services/dimaseinc-website` which triggers CF IP-based rate limiting if called too frequently.
**Fix:** Wait 8-10 minutes between deploy attempts. Rate limit clears on its own. Direct CF API calls hit the same IP rate limit — no shortcut. Wrangler OAuth token (`/root/.wrangler/config/default.toml`) expires ~1 hour from login but has refresh_token.
**Alias:** `deploy-website` = `cd /media/Storage/website/dimaseinc-website && npx wrangler deploy`

---

## dimase-monitor: Telegram Alerts Not Firing
**Symptom:** Monitor detected failures but no Telegram messages were sent
**Root cause:** `config.json` had `telegram.bot_token` (nested) but `monitor.py` looked for top-level `telegram_token` key.
**Fix:** Added flattened `telegram_token` and `telegram_chat_id` keys directly at top level of `config.json`.
**Values:** token=`8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw`, chat_id=`7826090533`

---

## mnt-buyvm-storage.mount Failed (Local Machine)
**Symptom:** `systemctl --failed` on local RHEL machine shows `mnt-buyvm-storage.mount FAILED`
**Root cause:** NAS/storage mount defined in fstab but the device is physically offline.
**Status:** Expected / intentional — not a problem. Do not attempt to fix unless storage device is reconnected.

---

## Spotify RSS Validation: Missing Cover Art + Email
**Symptom:** Spotify for Podcasters shows "Your podcast RSS feed is missing some things: Cover art, Email address"
**Fix 1 (email):** Add to RSS channel header in worker.js: `<itunes:owner><itunes:name>DiMase Inc.</itunes:name><itunes:email>dimaseinc@gmail.com</itunes:email></itunes:owner>`
**Fix 2 (cover art):** Generate 1400x1400px JPEG with Pillow on server. Save to `downloads/podcast-cover.jpg` (served by APK server at downloads.dimaseinc.org). Add Worker route `/podcast-cover.jpg` that proxies from downloads.dimaseinc.org. Add `<itunes:image href="https://dimaseinc.org/podcast-cover.jpg"/>` to RSS channel.
**Cover art location:** `/media/Storage/website/dimaseinc-website/downloads/podcast-cover.jpg`
**Spotify submission:** dimaseinc@gmail.com, account "DiMase Inc", submitted 2026-03-02, pending 3-5 days

---

## CF Wrangler Deploy Rate Limit — Dashboard Workaround
**Symptom:** Both `npx wrangler deploy` and direct CF API calls return 429 / error 1015
**Fix:** Deploy via CF dashboard directly:
1. `scp -i ~/Desktop/oci_key root@209.141.36.104:/media/Storage/website/dimaseinc-website/src/worker.js /tmp/worker.js`
2. Open: dash.cloudflare.com/7f31d839e01ef85781465f816b10c541/workers/services/edit/dimaseinc-website/production
3. Select all → paste → Deploy
**Note:** Rate limit is IP-based, hits both wrangler and direct API. Dashboard bypasses it entirely.

---

## Python Heredoc with Backticks Over SSH
**Symptom:** `python3 << 'EOF'` commands over SSH failed when the script content contained backtick characters
**Root cause:** Shell interprets backticks inside heredocs even with quoted delimiter in some SSH contexts.
**Fix:** Write script to local `/tmp/` first, then `scp` to server, then execute. Never use heredoc for scripts containing backticks.

---

## SSH Journal Noise (Local Machine)
**Symptom:** `/var/log` / journalctl shows repeated SSH errors: "kex_exchange_identification: read: Connection reset", "Protocol major versions differ: 2 vs. 1"
**Root cause:** Internet port scanners and bots probing port 22. Completely benign.
**Fix:** None needed. Firewalld is active and blocking malicious traffic.

---

## Logitech HID Protocol Errors (Local Machine)
**Symptom:** Kernel log shows `logitech-hidpp-device ... hidpp_root_get_protocol_version: received protocol error 0x08`
**Root cause:** Logitech HID++ protocol version negotiation quirk — benign kernel noise from mouse/keyboard.
**Fix:** None needed.

---

## D-Trading Post: Horseshoe → Cowboy Hat Logo
**Symptom:** Landing page hero showed a CSS horseshoe (upside-down U) instead of a cowboy hat
**Fix:** Replaced `.horseshoe-wrap` divs with inline SVG cowboy hat using site gold colors (#d4af37 body, #8b6914 band, #c49b2a shadow). Two instances replaced (large hero + smaller card version).
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## dimasehome.work: Ecosystem Admin Dashboard Deployed
**What:** New CF Worker "dimasehome" — dark gold admin hub showing all DiMase Inc services, Docker containers, D-Trading stats, live service checks, quick action links.
**Login:** admin / DiMaseAdmin2026 (cookie: dimasehome_session, 24hr HMAC)
**Binding:** DTRADING_DB → dtrading-db D1
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`

---

## D-Trading Post: Multiple 500 Route Errors After Merge
**Symptoms:** /contact, /sitemap returned 500; /sell, /dashboard, /admin returned 500; /profile/:username returned 500
**Root causes (4 bugs found):**
1. `contactPageHTML` and `sitemapPageHTML` stripped as duplicates during merge — functions missing entirely
2. `getCookie(request, 'session')` used wrong cookie name — should be `dtrading_session`
3. `Response.redirect('/path', 302)` fails in CF Workers — requires absolute URL or manual Response
4. Missing `return` on redirect statements: `if (!user) new Response(...)` without `return` — code continued executing on null user
5. `user.email.split('@')` called on null email in profilePageHTML and nav — no null check
**Fixes:** Added missing functions, fixed cookie name, replaced Response.redirect with manual Response, added return keywords, added email null-safety checks
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## DiMase AI: D-Trading Post Integration
**What:** DiMase can now query live D-Trading Post listings and stats
**API endpoints added:**
- `https://dtradingpost.dimaseinc.org/api/public?type=listings` — all active listings as JSON
- `https://dtradingpost.dimaseinc.org/api/public?type=stats` — site stats (users, listings, revenue)
- `https://dtradingpost.dimaseinc.org/api/public?type=listings&q=QUERY` — search listings
**System prompt:** Updated in `/media/Storage/server-flies/dimase_nexus/nexus.py` to include D-Trading Post API URLs. DiMase uses fetch_url tool to get live data.

---

## dimaseinc.org: D-Trading Post Added to Landing Page + Cloud Panel
**What:** D-Trading Post link added in two places on dimaseinc.org:
1. Cloud Panel services grid (line ~2552 in worker.js) — shows as a service card
2. Landing page feat-grid (line ~3352) — shopping bag icon, "D-Trading Post" title, marketplace description
**Deployed:** 2026-03-02, Version ID: 95a4a59e-7eca-4f53-a017-821275270eb7
**Deploy method:** Local machine (bypass server 429 rate limit) using WRANGLER_HOME=/home/dimase/.config/.wrangler
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js`

---

## D-Trading Post: FFL Notice + $300 Admin Approval + Seller Responsibilities
**Date:** 2026-03-02
**Changes:**
- Added "Firearms" category to marketplace
- Red FFL notice on registration page with ATF FFL Locator link (https://www.atfonline.gov/fflezcheck/)
- Listings over $300 auto-set to `pending_review` status (hidden from marketplace until admin approves)
- Admin dashboard shows pending listings table with Approve/Reject buttons (/admin?action=approve&lid=ID)
- Firearms listings show orange FFL banner on listing detail page
- Terms updated: §1.4 Seller Responsibilities (ship what you list, shipping included in price, 5-day shipment), §1.5 Platform Non-Responsibility (not liable for items, refunds go to seller email on profile)
- Terms & Conditions link added to footer (Site Map column + fine print)
- `paypal_payout_email` column added to users D1 table for seller PayPal payouts
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## DiMase Locksmith: New Site Deployed
**Date:** 2026-03-02
**URL:** https://locksmith.dimaseinc.org
**Worker:** dimase-locksmith
**D1 DB:** dimase-locksmith (c68d2183-a97c-4a3d-a781-9de2b58f6d7e)
**Features:** Service request form (name/phone/address/car details/notes), Telegram notification to owner on submit, PayPal payment link (paypal.me/DiMaseInc), admin panel at /admin (password: LockAdmin2026) with status tracking (new/contacted/completed/cancelled)
**Service types:** Car Lockout, House/Business Lockout, Key Replacement, Lock Installation, Emergency
**Files:** /media/Storage/server-flies/apps/dimase-locksmith/worker.js + wrangler.toml
**Source on USB:** /run/media/dimase/Ventoy/source-code/dimase-locksmith/worker.js

## dimaseinc.org: Locksmith Tile Added + Source Code USB Backup
**Date:** 2026-03-02
**Changes:** Added DiMase Locksmith feat-card to landing page + Locksmith service to Cloud Panel services grid
**Deployed:** Version ca248b97
**USB Source Backup:** /run/media/dimase/Ventoy/source-code/ (all 4 sites: dimaseinc-website, dtrading-post, dimase-locksmith, dimasehome)
