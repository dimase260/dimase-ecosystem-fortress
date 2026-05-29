# DiMase Inc — Documented Fixes & Solutions
> Training reference: each entry includes root cause, symptom, and exact fix.
> Updated: 2026-03-27 (session 6)

---

## Pollinations Mass Model Removal (2026-03-27)
**Symptom:** All Pollinations models returning 404 "This is our legacy API" or 429 queue full.
**Root cause:** Pollinations shut down most of their free model list — only `openai` (now openai-fast/GPT-OSS 20B via OVH) remains. mixtral-8x7b-32768, gemma2-9b-it, llama, mistral, gemini, openai-large, deepseek, learnlm, claude-hybridspace, grok, searchgpt all 404.
**Fix:** Replaced Pollinations entirely with:
- **Groq API** (free, 30 req/min): llama-3.3-70b-versatile, llama-4-scout-17b, qwen/qwen3-32b, moonshotai/kimi-k2-instruct, openai/gpt-oss-120b, llama-3.1-8b-instant, groq/compound
- **Local Ollama**: qwen3:latest, llama3.2:3b, phi3:mini
- Groq key in axis-control/.env + launch.sh + axis-monitor.service (server)

---

## Groq Models Decommissioned (2026-03-27)
**Symptom:** groq-mixtral (mixtral-8x7b-32768) and groq-gemma (gemma2-9b-it) return HTTP 400 "model has been decommissioned".
**Fix:** Replaced with newer models:
- mixtral-8x7b-32768 → meta-llama/llama-4-scout-17b-16e-instruct
- gemma2-9b-it → qwen/qwen3-32b
**How to check available Groq models:** `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`

---

## Groq Qwen3 Reasoning Tags in Response (2026-03-27)
**Symptom:** Qwen3-32b responses start with `<think>...</think>` blocks showing chain-of-thought.
**Root cause:** Qwen3 is a reasoning model that outputs thinking steps before the answer.
**Fix:** Added regex strip in `_call_groq()`: `re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()`
**Note:** Also apply same strip in consciousness loop for any model that might emit think tags.

---

## Axis Control Models Dot Not Turning Green (2026-03-27)
**Symptom:** The `dot-models` status indicator in the top bar stays steel/grey even when models are online.
**Root cause:** `loadModels()` counted `online` variable but never used it to update `dot-models` element class.
**Fix:** Added after counting online models:
```javascript
const dot = document.getElementById('dot-models');
if (online === models.length)           dot.className = 'dot green';
else if (online >= models.length * 0.6) dot.className = 'dot gold';
else if (online > 0)                    dot.className = 'dot steel';
else                                    dot.className = 'dot dim';
```

---

## Axis Control Consciousness Was Fake (2026-03-27)
**Symptom:** Consciousness bar showed generic system messages, not real AI reasoning about actual state.
**Root cause:** Prompt was minimal ("generate 2-3 sentences about CPU/RAM") and used slow Axis Nexus endpoint rather than a capable local model.
**Fix:** Rebuilt consciousness_loop() in app.py:
- Uses **Groq Llama 3.3 70B** (0.17s response) for real reasoning
- Prompt includes: real model statuses, real CPU/RAM, last 6 conversation exchanges, stored memory keys, active goals, live AI news (DuckDuckGo, hourly)
- Auto-extracts observations into persistent memory.json
- Updates mood field (optimal/operational/monitoring/degraded) based on real state
- Falls back to Axis Nexus if Groq unavailable
- Fires every 60s (was 45s)

---

## Pollinations 429 "Queue Full" — All Models Simultaneously (2026-03-26)
**Symptom:** Council mode fires 12+ models at once → all get 429 "Queue full" from Pollinations free tier.
**Root cause:** Free tier allows 1 queued request per IP. Simultaneous parallel calls exhaust queue instantly.
**Fix:**
- Added `_POLL_SEM = threading.Semaphore(2)` in `model_council.py` — max 2 concurrent Pollinations calls
- Added 0.4s stagger between model thread submissions in `query_all()`
- Added retry-once logic: if 429 received, sleep 3s and retry the same request once
```python
_POLL_SEM = threading.Semaphore(2)
def _call_pollinations(model, messages):
    with _POLL_SEM:
        return _do_pollinations(model, messages)
```

---

## `command-r` Model 404 from Pollinations (2026-03-26)
**Symptom:** `command-r` model always returns 404 / "This is our legacy API" error from Pollinations.
**Root cause:** Pollinations removed command-r from their current API.
**Fix:** Replaced with `openai-large` (GPT-4o Large) in:
- `model_council.py`: `_POLL_MAP["openai-large"] = "openai-large"`
- `telegram_bot_upload.py`: replaced `command-r` entry with `openai-large` / `GPT-4o LARGE`

---

## Ann's Bibliotheca Login Bypass Not Working (2026-03-26)
**Symptom:** Ann types `gieseann44@gmail.com` / `7878` → login fails; only `Ann` username worked before.
**Root cause:** Bypass check only matched the string `'ann'` (username), not her email address.
**Fix:** Updated bypass condition:
```javascript
const isAnn = (input.toLowerCase() === 'ann' || input.toLowerCase() === 'gieseann44@gmail.com');
if (isAnn && pw === '7878') { ... }
```

---

## Ann's Bibliotheca Black Screen After Removing Login (2026-03-26)
**Symptom:** After removing login requirement, page loads but shows nothing — black screen.
**Root causes (two):**
1. `<div id="app" style="display:none">` — inline style prevented `display:''` from working
2. JS syntax errors in `doSearch()` and `setCat()` — unclosed parenthesis broke entire script:
   ```javascript
   // BROKEN — unclosed (
   document.getElementById('sec-feat') && (document.getElementById('sec-feat').style.display = query ? 'none' : '';
   // FIXED
   const sf = document.getElementById('sec-feat'); if (sf) sf.style.display = query ? 'none' : '';
   ```
**Fix:**
1. Removed `style="display:none"` attribute from `<div id="app">` entirely
2. Changed `showApp()` to use explicit `style.display = 'block'`
3. Fixed JS syntax errors with null-check pattern

---

## The Alpha's Contract (GoodNovel) Paywalled After Free Chapters (2026-03-26)
**Symptom:** Featured hero novel cuts off after a few chapters and demands app download.
**Root cause:** GoodNovel is a commercial platform — free preview only, premium content locked.
**Fix:** Replaced hero novel with "Rejected by the Alpha" (Wattpad story/17539298):
- Verified free, completed, ~17M reads, no paywall
- Updated hero card onclick, title, description, button text, and URLS dict in ann-reads.html
- Cannot host copyrighted commercial novel content directly on server

---

## Ann's Bibliotheca JS Syntax — Apostrophe in onclick String (2026-03-26)
**Symptom:** Clicking featured novel card throws JS error; `openDirect()` never fires.
**Root cause:** `onclick="openDirect('The Alpha\'s Contract')"` — escaped apostrophe inside HTML attribute double-quoted string causes parse error.
**Prevention:** Use Python patch scripts for all JS edits in HTML files. Never write apostrophes in onclick attribute string values — use `&#39;` or restructure to avoid.

---

## Ann's Bibliotheca ACPL OverDrive Integration (2026-03-26)
**Summary:** Added full Library section to ann-reads.html linking to Allen County Public Library OverDrive catalog.
- Genre tiles link to `https://acpl.overdrive.com/subjects/{Genre}?formats=ebook`
- Search routes to `https://acpl.overdrive.com/search?query={q}&formats=ebook`
- Quick searches (alpha shifter, mafia, vampire, fae, etc.) are pre-filled search links
- "Available Now", "New Releases", "Most Popular" etc. link to catalog browse pages
- User signs in once with ACPL library card → reads in OverDrive web reader, no app needed

---

## VNC Broken — 15 Orphaned websockify Processes (2026-03-07)
**Symptom:** vnc.dimaseinc.org shows blank/error; noVNC won't connect.
**Root cause:** 15 orphaned `websockify` processes all bound port 6080 via SO_REUSEPORT from previous manual `nohup websockify` commands; WebSocket requests routed non-deterministically between stale + live processes.
**Fix:**
```bash
pkill -f websockify   # kill all 15 orphaned processes
# systemd novnc.service auto-restarted with single clean instance
# Hardened novnc.service to prevent recurrence:
# RestartSec=5, StartLimitIntervalSec=60, StartLimitBurst=5
```
**Prevention:** Never run `nohup websockify` manually — always use `systemctl start/restart novnc`.

---

## Worker.js Function Inside HTML Template Literal (2026-03-07)
**Symptom:** esbuild error "Expected ')' but found 'INSERT'" at a JS function keyword inside worker.js.
**Root cause:** Insertion script found `<script>` keyword inside an HTML template literal string and inserted a JS function there instead of at true top-level scope. The function ended up inside a template literal — syntactically invalid for esbuild.
**Fix:** Use Python script to extract the misplaced function (by line range), remove it, and re-insert it at true top-level before `export default {`. Always verify insertion point with `grep -n "export default" worker.js` first.
**Prevention:** When writing Python patch scripts to insert functions, always verify target line is NOT inside a template literal by checking surrounding lines for backtick context.

---

## Learning Page Content Disappeared After Section Insert (2026-03-07)
**Symptom:** After adding Reading Mastery section to learning.html, all class list content disappeared; only Reading Mastery cards showed.
**Root cause:** HTML insertion placed new content before `<!-- CLASS LIST VIEW -->` but omitted the closing `</div>` for the dashboard-view container that wraps the level grid. This caused CLASS LIST VIEW to render inside the grid container, collapsing the layout.
**Fix:** Python patch added missing `</div>` between the new section's closing grid div and the `<!-- CLASS LIST VIEW -->` comment.
**Pattern:** Every learning track section ends with the level grid div closing tag — the next thing after that MUST be `</div>` (closes dashboard-view) then `<!-- CLASS LIST VIEW -->`.

---

## AxisAI.apk Not Installing on Phone (2026-03-07)
**Symptom:** Original axis-2.0.apk (4.8MB) fails to install; Android shows error or silent failure.
**Root cause:** Original was a React Native/Flutter app (package org.dimaseinc.axis, minSDK 26) — likely cert conflict with previous install attempt or incompatibility issues.
**Fix:** Rebuilt as clean 17KB WebView APK:
- Package: com.dimaseinc.axisai (new package name avoids cert conflict)
- minSDK 21 (Android 5.0+) — broader compatibility than original minSDK 26
- Loads https://dimaseinc.org/axis/chat-ui in WebView
- Signed with new keystore (alias: axisai, pass: dimase2026)
- File saved: /media/Storage/website/dimaseinc-website/downloads/AxisAI.apk
- applications.html updated to link AxisAI.apk (not axis-2.0.apk)

---

## Android APK Build Without Android Studio (2026-03-05)
**Symptom:** Need a real `.apk` file but no Android Studio / buildozer environment.
**Root cause:** Server had only `openjdk-17-jre-headless` (no `javac`), no Android SDK, no buildozer.
**Fix:** Install Android SDK command-line tools + JDK, build minimal WebView APK manually:
```bash
# 1. Install JDK
apt-get install -y openjdk-17-jdk

# 2. Download Android SDK cmdline-tools
mkdir -p /media/Storage/android-sdk/cmdline-tools
cd /media/Storage/android-sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip
unzip cmdline-tools.zip && mv cmdline-tools latest

# 3. Install build tools + platform
export ANDROID_HOME=/media/Storage/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
yes | sdkmanager "build-tools;34.0.0" "platforms;android-34"

# 4. Compile resources → link → compile Java → dex → zip → align → sign
BUILD_TOOLS=$ANDROID_HOME/build-tools/34.0.0
PLATFORM=$ANDROID_HOME/platforms/android-34
aapt2 compile --dir res -o compiled.zip
aapt2 link compiled.zip -I $PLATFORM/android.jar --manifest AndroidManifest.xml -o unsigned.apk --java src --auto-add-overlay
javac -source 8 -target 8 -classpath $PLATFORM/android.jar -bootclasspath $PLATFORM/android.jar -d obj src/**/*.java
$BUILD_TOOLS/d8 --output . $(find obj -name "*.class" | tr "\n" " ")
python3 -c "import zipfile,shutil; shutil.copy('unsigned.apk','with_dex.apk'); zipfile.ZipFile('with_dex.apk','a').write('classes.dex')"
$BUILD_TOOLS/zipalign -f 4 with_dex.apk aligned.apk
keytool -genkey -v -keystore debug.jks -alias dimase -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=DiMase Inc,..." -storepass dimase2026 -keypass dimase2026
$BUILD_TOOLS/apksigner sign --ks debug.jks --ks-key-alias dimase --ks-pass pass:dimase2026 --key-pass pass:dimase2026 --out App.apk aligned.apk
```
**Notes:** `zip` not installed on server — use Python zipfile to add classes.dex. apksigner uses `--ks-key-alias` not `--ks-alias`. WebView APK loads URL, no Kivy/buildozer needed.
**Result:** `DiMaseAntiVirus.apk` (17KB), valid signed APK at `https://dimaseinc.org/downloads/DiMaseAntiVirus.apk`
**SDK location:** `/media/Storage/android-sdk/` (build-tools;34.0.0, platforms;android-34)

---

## Wrangler 429 Deploy Fallback (2026-03-05)
**Symptom:** `npx wrangler deploy` on server → "Failed to fetch auth token: 429 Too Many Requests"
**Root cause:** Cloudflare rate-limits OAuth token refreshes from the server IP after repeated deploys in a session.
**Fix:** Deploy from local machine using local wrangler token:
```bash
rsync -av --exclude='node_modules' --exclude='downloads' --exclude='app-builds' --exclude='.git' buyvm:/media/Storage/website/dimaseinc-website/ /tmp/deploy_site/
cd /tmp/deploy_site && WRANGLER_CONFIG_PATH=/home/dimase/.config/.wrangler/config/default.toml npx wrangler deploy
```
**After ~45 min:** server can deploy again normally.

---

## Typing API: Admin Routes Always Returning 403 Forbidden (2026-03-05)
**Symptom:** `POST /typing/classes`, `PUT /typing/classes/:id`, `DELETE /typing/classes/:id` returned 403 even for admin users with a valid token.
**Root cause:** Admin checks used `if (!payload || !payload.isAdmin)`, but `createApiToken()` never embeds `isAdmin` in the JWT payload — it only stores `userId`, `email`, and `exp`. So `payload.isAdmin` is always `undefined` → falsy → 403.
**Fix:** Replace `payload.isAdmin` checks with a DB lookup, matching the pattern used in `handleLearningApi`:
```js
const adminCheck = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
if (!adminCheck || !adminCheck.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
```
**Pattern:** Any new API handler that needs admin auth must use the DB lookup pattern. `payload.isAdmin` from `verifyApiToken` is always undefined — never rely on it.
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js` — `handleTypingApi()`

---

## Cloudflare Worker: Podcast Upload "Unauthorized"
**Symptom:** Clicking "Upload to Server" in Cloud Panel → red "✗ Unauthorized" message
**Root cause:** `fetch('/podcast/upload', {...})` in `uploadEpisodeFile()` did not include `credentials: 'include'`. Browsers do not send cookies by default on `fetch()`, so the `cloud_session` cookie was never sent to the Worker. The Worker's auth gate at line 2032 saw no cookie and returned 401.
**Fix:** Added `credentials: 'include'` to the fetch call in `worker.js` line ~3056.
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js`
**Session expiry note:** `cloud_session` token expires after 1 hour (`Date.now() - token.ts > 3600000`). If Unauthorized appears again, re-login at `/cloud`.

---

## axis-model-scout.service: ModuleNotFoundError httpx
**Symptom:** `systemctl status axis-model-scout.service` shows `ModuleNotFoundError: No module named 'httpx'`
**Root cause:** `httpx` was installed via pip but the service ran before installation completed, OR pip install was done without `--break-system-packages` on Ubuntu 24.04 (PEP 668 protection).
**Fix:** `pip3 install httpx --break-system-packages` (httpx 0.28.1 installs to `/usr/local/lib/python3.12/dist-packages/`). Script then ran cleanly — 29 free models catalogued, Telegram notified.
**File:** `/root/axis-monitor/model_scout.py`

---

## axis-monitor: Portainer Healer Spam
**Symptom:** axis-monitor logs showed healer hitting 2/3 retry attempts every 300s trying to restart "portainer" — `docker restart portainer` → "No such container"; `docker compose up portainer` → "no such service: portainer"
**Root cause:** "portainer" was listed in `DOCKER_CONTAINERS` in monitor.py and in `config.json` under `services.http`, but portainer is NOT a container in `docker-compose-live.yml`. It runs outside Docker compose (accessible at portainer.dimaseinc.org but managed separately).
**Fix:** Removed "portainer" from `DOCKER_CONTAINERS` in `monitor.py` and from `services.http` in `config.json`. Monitor now reports 18/18 healthy.
**Files:** `/root/axis-monitor/monitor.py`, `/root/axis-monitor/config.json`

---

## axis-hud Frontend: esbuild EACCES Permission Denied
**Symptom:** `npx vite build` failed with `spawn .../node_modules/@esbuild/linux-x64/bin/esbuild EACCES`
**Root cause:** esbuild binary lost execute permission (likely from a file copy or mount operation that stripped execute bits).
**Fix:** `chmod +x /media/Storage/server-flies/apps/axis-2.0/frontend/node_modules/@esbuild/linux-x64/bin/esbuild` then `chmod -R +x node_modules/.bin/`. Build succeeded (304.94 kB JS, 11.61s). Note: `frontend/dist/` is directly mounted into the axis-hud nginx container — no copy needed after build.
**File:** `/media/Storage/server-flies/apps/axis-2.0/frontend/`

---

## axis-nexus: "Inference Error: All connection attempts failed"
**Symptom:** https://axis.dimaseinc.org chat showed "Inference Error: All connection attempts failed" on every message
**Root cause:** `nexus.py` was hardcoded to call Ollama at `localhost:11434`, but Ollama is NOT installed on the BuyVM VPS.
**Fix:** Replaced all Ollama calls with `https://dimaseinc.org/axis/bot-chat` (CF Workers AI endpoint). Also fixed port `8001 → 8000` mismatch between `nexus.py` main() and Dockerfile EXPOSE + nginx proxy config.
**Version:** axis-nexus rebuilt as v3.0.0 with full ReAct agent loop.
**File:** `/media/Storage/server-flies/axis_nexus/nexus.py`

---

## axis-nexus v3.0.0: ReAct Agent Loop
**What was added:** Full agentic tool-use loop using ACTION/INPUT/FINAL text format (works with any LLM — no function calling API needed).
**Tools available:** web_search (DuckDuckGo dual-API), fetch_url, shell_exec, file_read, file_write, docker_ops, remember (ChromaDB), recall (ChromaDB similarity), git_ops
**AI fallback chain:** CF Workers AI (bot-chat) → Pollinations.ai (free GET API) → Groq (if key set)
**Safety:** shell_exec has blocklist for destructive commands; file paths whitelist enforced
**Files:** `/media/Storage/server-flies/axis_nexus/nexus.py`, `/media/Storage/server-flies/axis_nexus/tool_controller.py`

---

## Axis AI: Hallucination / Fabricating Facts
**Symptom:** Axis answered questions about current weather with made-up data, gave wrong info about Claude architecture
**Root cause:** System prompt contained "never vague or generic" and "answer with actual information" — this pressured the model to invent plausible-sounding answers rather than admit uncertainty.
**Fix:** Replaced with: "You do NOT have access to real-time data (no live weather, news, stock prices, or current events) — say so clearly when asked. Never invent specific facts or technical details you cannot verify."
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js` (system prompt section)

---

## Axis AI Chat: "As the primary intelligence agent of DiMase Inc.,"
**Symptom:** Every response from axis.dimaseinc.org started with "As the primary intelligence agent of DiMase Inc.," — repetitive, robotic
**Root cause:** System prompt phrasing caused the model to use this as a framing opener for every reply.
**Fix (frontend):** Added `filterResponse()` function to `App.jsx` that strips the phrase and common variants via regex before rendering.
**Fix (backend):** System prompt updated to explicitly say not to use this opener.
**File:** `/media/Storage/server-flies/apps/axis-2.0/frontend/src/App.jsx`

---

## axis-hud: Auto-Scroll Missing
**Symptom:** New messages in axis.dimaseinc.org chat panel did not scroll into view automatically
**Fix:** Added `useRef` scroll anchor to `App.jsx`: `const messagesEndRef = useRef(null)` + `useEffect` watching `[messages, isProcessing]` + `<div ref={messagesEndRef} />` at bottom of message list.
**File:** `/media/Storage/server-flies/apps/axis-2.0/frontend/src/App.jsx`

---

## APK Installation Failure (V1-only Signature)
**Symptom:** Axis 2.0 APK downloaded but Android refused to install ("App not installed")
**Root cause:** `jarsigner` only produces V1 (JAR) signatures. Modern Android requires V2 or V3 APK signatures.
**Fix:** Re-signed with `uber-apk-signer.jar` which adds V2+V3 signatures automatically.
**Command:** `java -jar /tmp/uber-apk-signer.jar -a axis-2.0-signed.apk --allowResign --ks /home/dimase/dimaseinc-release.jks --ksAlias dimaseinc-release --ksPass DiMaseInc2026 --ksKeyPass DiMaseInc2026 --skipZipAlign`
**Also required:** Users must uninstall old Axis AI first if certificate changed (Android blocks signature downgrades).

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

## axis-monitor: Telegram Alerts Not Firing
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

## Axis AI: D-Trading Post Integration
**What:** Axis can now query live D-Trading Post listings and stats
**API endpoints added:**
- `https://dtradingpost.dimaseinc.org/api/public?type=listings` — all active listings as JSON
- `https://dtradingpost.dimaseinc.org/api/public?type=stats` — site stats (users, listings, revenue)
- `https://dtradingpost.dimaseinc.org/api/public?type=listings&q=QUERY` — search listings
**System prompt:** Updated in `/media/Storage/server-flies/axis_nexus/nexus.py` to include D-Trading Post API URLs. Axis uses fetch_url tool to get live data.

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
**Service types:** Car Lockout, House/Business Lockout, Lock Installation, Emergency (no key cutting/replacement)
**Files:** /media/Storage/server-flies/apps/dimase-locksmith/worker.js + wrangler.toml
**Source on USB:** /run/media/dimase/Ventoy/source-code/dimase-locksmith/worker.js

## dimaseinc.org: Locksmith Tile Added + Source Code USB Backup
**Date:** 2026-03-02
**Changes:** Added DiMase Locksmith feat-card to landing page + Locksmith service to Cloud Panel services grid
**Deployed:** Version ca248b97
**USB Source Backup:** /run/media/dimase/Ventoy/source-code/ (all 4 sites: dimaseinc-website, dtrading-post, dimase-locksmith, dimasehome)

---

## dimaseinc.org: Our Services (index.html) — Consulting → Trading Post + Locksmith
**Date:** 2026-03-03
**Change:** Replaced Consulting tile in static index.html "Our Services" section with D-Trading Post tile (dtradingpost.dimaseinc.org) and DiMase Locksmith tile (locksmith.dimaseinc.org)
**Deploy note:** index.html is a static ASSET — must use wrangler deploy (not dashboard paste). Deployed from local machine using WRANGLER_HOME=/home/dimase/.config/.wrangler after re-auth via `wrangler login`.
**Deployed:** Version 612e0639
**File:** /media/Storage/website/dimaseinc-website/index.html + USB backup updated

---

## DiMase Locksmith: Phone Number Cleanup + Remove Key Services
**Date:** 2026-03-03
**Changes:**
- Phone number (513-748-2017) now only on nav "📞 Call Now" button. Removed from: hero button, green live badge, form subtitle, confirmation page, footer, pay page
- Removed "Key Replacement" service card from services grid
- Removed "Key Replacement / Duplication" and "Lock Re-Key" from form dropdown options
- Updated service descriptions to remove keys/re-key language
**Deployed:** Version 7e014cd0
**File:** /media/Storage/server-flies/apps/dimase-locksmith/worker.js (USB backup updated)

---

## D-Trading Post: Login Crash (Error 1101) — DB Column Mismatch
**Date:** 2026-03-03
**Root cause:** Worker queried `password_salt` and `is_admin` but DB columns are `salt` and `role`
**Fixes:** SELECT: password_salt→salt, is_admin→role | hash check: user.password_salt→user.salt | INSERT: password_salt→salt, removed subscription_due, VALUES 7→6 | all session.is_admin→session.role==='admin'
**Deployed:** Version 4c741697

---

## DiMase Locksmith: /request Form Crash — Missing DB Column
**Date:** 2026-03-03
**Root cause:** service_requests table missing service_detail column; INSERT included it
**Fix:** ALTER TABLE service_requests ADD COLUMN service_detail TEXT (run on D1 directly, no redeploy)

---

## DiMase Locksmith: Admin Work Order Detail Page
**Date:** 2026-03-03
**Changes:** Added orderDetailPage(), /admin/order/:id route, gold "View" button per row, status update redirects back to detail page
**Deployed:** Version 60fdb5c9

---

## D-Trading Post: Donate Button + Login Page Cleanup
**Date:** 2026-03-03
**Changes:** Added /donate → paypal.me/DiMaseInc redirect (was 404). Removed FFL notice from loginPageHTML (should only be on register page)
**Deployed:** Version e9171be8

---

## PayPal URL Update — Both Sites
**Date:** 2026-03-03
**Change:** Updated donate/payment PayPal URL to https://www.paypal.biz/mrcdimase on both D-Trading Post and DiMase Locksmith
**D-Trading Post deployed:** Version c7c1bf4f
**DiMase Locksmith deployed:** Version 0cba66a8
**USB backup updated:** /run/media/dimase/Ventoy/source-code/ (both workers)

---

## DiMase Inc. Logo
**Date:** 2026-03-03
**File:** /home/dimase/Pictures/DiMase_Inc_Logo.jpg (1200x600px, black/gold branding)
**Also:** /home/dimase/Pictures/DiMase_Inc_Logo.png (source PNG)

---

## Full Site Audit + Critical Bug Fixes — 2026-03-03
**Date:** 2026-03-03

### D-Trading Post — Critical Fixes (Deployed: f3a70db5)
- Registration confirm_password field name mismatch fixed
- Username auto-generated from email prefix (users table NOT NULL constraint)
- /api/list (post listing) now requires auth and passes session → fixes error 1101
- /bid and /buy now pass session to handlers
- /browse redirects to /marketplace

### dimaseinc.org — Route Fixes (Deployed: 850fbeb5)
- Root / now serves landingPageHTML() (was showing login page — regression)
- /cloud redirects to home.dimaseinc.org for auth users
- /downloads redirects to downloads.dimaseinc.org

### locksmith.dimaseinc.org — Pricing JS Fix (Deployed: dacaadec)
- All 5 client-side pricingMap/PRICES objects updated to correct job costs

### Known Remaining
- dimaseinc.org /subscribe: PayPal plan IDs empty — needs PayPal dev dashboard setup
- vnc.dimaseinc.org: WebSocket VNC connection fails through Cloudflare

---

## CF Wrangler 429 Rate Limit on Server — Local Deploy Workaround
**Date:** 2026-03-03
**Symptom:** `npx wrangler deploy` from BuyVM server returns `429 Too Many Requests` from Cloudflare API
**Root cause:** Cloudflare rate-limits rapid sequential wrangler deploy calls from same IP
**Fix:** Deploy from local machine instead:
```bash
# 1. Pull worker files from server
scp buyvm:/path/to/worker.js /tmp/deploy_dir/src/worker.js
scp buyvm:/path/to/wrangler.jsonc /tmp/deploy_dir/wrangler.jsonc
# 2. Deploy from local (uses local OAuth token at ~/.config/.wrangler/config/default.toml)
cd /tmp/deploy_dir && npx wrangler deploy
```
Local wrangler token at /home/dimase/.config/.wrangler/config/default.toml — valid as of 2026-03-03.
Note: for workers with relative asset paths (dimaseinc-website uses `"directory": "./"`) the full source dir structure must be present locally or the assets binding will fail to find files.

---

## PayPal Billing Plan Deactivate Returns 204 No Content
**Date:** 2026-03-03
**Symptom:** `urllib.request.urlopen()` on PayPal deactivate endpoint → `json.loads()` raises JSONDecodeError on empty body
**Root cause:** PayPal DELETE/deactivate endpoints return HTTP 204 No Content with empty body — not JSON
**Fix:** Check for empty body before parsing:
```python
body = resp.read()
if not body:
    return {"status": resp.status}  # 204 No Content
return json.loads(body)
```

---

## Python Patch Scripts via SSH — Avoid Heredoc with HTML/JS
**Date:** 2026-03-03
**Symptom:** SSH heredoc executing Python that contains HTML/JS with `<div>`, `&rarr;`, `${...}` — shell interprets those characters, breaks script
**Root cause:** Bash heredoc does not protect against shell glob expansion, history expansion, or command substitution when content has special chars
**Fix:** Write Python script to local /tmp/*.py file first, then scp to server and run:
```bash
# Write script locally with Write tool
scp /tmp/patch_foo.py buyvm:/tmp/
ssh buyvm 'python3 /tmp/patch_foo.py'
```
Never use `ssh buyvm "python3 - << 'EOF' ... EOF"` with HTML/JS content.

---

## 5-Tier PayPal Billing Plans — Pricing Overhaul (2026-03-03)
**Change:** Replaced 4-plan system ($5/$30 + coupon variants) with 5 clean plans:
- PAYPAL_PLAN_SITE: P-5L7087390B020105MNGTRRZY ($7/mo)
- PAYPAL_PLAN_RDP: P-2HM15138MG861461XNGTRRZY ($35/mo)
- PAYPAL_PLAN_SELLER: P-6E6499222C278780DNGTRRZY ($45/mo)
- PAYPAL_PLAN_RDP_SELLER: P-92C233197F581044CNGTRR2A ($65/mo)
- PAYPAL_PLAN_BUNDLE: P-4R079839XY380984HNGTRR2A ($75/mo)
Old 4 plans deactivated. All secrets set on dimaseinc-website worker.
SUPERNERD coupon removed. Landing page and register page updated from $5→$7 references.


---

## CF Wrangler 429 — Deploy Policy (Updated 2026-03-03)
**Policy:**
1. Always attempt deploy FROM SERVER first: `ssh buyvm 'cd /path && npx wrangler deploy'`
2. Add `sleep 30` between consecutive server deploys to reduce rate limit chance
3. If server returns 429, fall back to local deploy (scp worker + wrangler config to /tmp/deploy_dir/, `cd /tmp/deploy_dir && npx wrangler deploy`)
4. After ~45 minutes, verify server can deploy cleanly again by re-running deploy from server
5. Log any 429 fallback incidents in fixes.md
**Root cause:** Cloudflare rate-limits rapid wrangler API calls from same IP. Affects burst deployments (3+ workers in quick succession).

---

## D-Trading Post Admin Page — Error 1101 Worker Exception
**Date:** 2026-03-03
**Symptom:** Navigating to `dtradingpost.dimaseinc.org/admin` returns CF Error 1101 "Worker threw exception"
**Root cause:** `handleAdmin()` function called `adminPageHTML(user, stats, pendingListings)` but `user` variable was never defined in scope — causes `ReferenceError: user is not defined` at runtime
**Fix:** Added `const user = { username: ADMIN_USER, role: 'admin' };` immediately before the `adminPageHTML()` call in `handleAdmin()` (line ~4131 in worker.js)
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## D-Trading Post Admin Page — Raw Template Literal Text Displayed + All Links Error 1101
**Date:** 2026-03-03
**Symptoms:**
- Admin page shows raw JS code (`${pendingListings.map(l => ``).join("")}`) as literal text
- Approve/Reject buttons link to `/admin?action=approve&lid=${l.id}` (literal, not evaluated)
- All quick action links (/admin/users, /admin/payments, /admin/init-db) return Error 1101
**Root causes:**
1. `adminPageHTML` had nested template literals inside the outer `content` template, all with `\${}` escaping — nothing evaluated
2. `handleAdminUsers`, `handleAdminUserAction`, `handleAdminPayments`, `handleAdminUserIntelInternal` all referenced `user` variable that was never defined in scope → ReferenceError → 1101
**Fix:**
1. Extracted pendingListings section into a pre-computed `pendingHTML` variable (built before `content` template using a separate template literal) — avoids nested template literal escaping
2. Added `const user = { username: ADMIN_USER, role: 'admin' };` at top of each affected handler
3. In `handleAdminUserIntelInternal`: aliased `const user = adminUser || { username: ADMIN_USER, role: 'admin' }`

---

## D-Trading Post Admin — handleInitDB Error 1101 (SCHEMA_SQL not defined)
**Date:** 2026-03-03
**Symptoms:** "Init Database" button returns Error 1101; logs show `ReferenceError: user is not defined` then `ReferenceError: SCHEMA_SQL is not defined`
**Root causes:**
1. `handleInitDB` called `westernLayout(..., user)` but never defined `user`
2. `SCHEMA_SQL` constant referenced but never defined anywhere in worker (was meant to be imported from a separate part2 file)
**Fixes:**
1. Added `const user = { username: ADMIN_USER, role: 'admin' };` after auth check in `handleInitDB`
2. Defined `SCHEMA_SQL` as a full `CREATE TABLE IF NOT EXISTS` string constant covering all 6 tables (users, listings, bids, transactions, sessions, subscription_payments) placed directly before `handleInitDB`
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## D-Trading Post Admin — `subscriptions` Table Not Found (no such table)
**Date:** 2026-03-03
**Symptom:** Admin stats, users, and payments pages all log `D1_ERROR: no such table: subscriptions`
**Root cause:** All 19 SQL queries used `FROM subscriptions` / `JOIN subscriptions` etc., but the actual table is named `subscription_payments`
**Fix:** Global sed replace across worker.js: `subscriptions` → `subscription_payments` in all SQL query strings (FROM, JOIN, WHERE, INTO, UPDATE clauses). 19 occurrences fixed.
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## D-Trading Post Admin — Settler Registry Shows 0 (subscription_type column missing)
**Date:** 2026-03-03
**Symptom:** Admin page shows "1 Total Settlers" but Settler Registry `/admin/users` shows "0 total, No settlers registered yet"
**Root causes:**
1. Users query selected `s.subscription_type` but `subscription_payments` table has no such column — column is named `plan_type`
2. COUNT queries included the admin account (role='admin') in "Total Settlers"
3. Users list query had no WHERE clause to exclude admin
**Fixes:**
1. Changed `s.subscription_type` → `s.plan_type AS subscription_type` in users query
2. Added `WHERE role != 'admin'` to both `SELECT COUNT(*)` queries
3. Added `WHERE u.role != 'admin'` to users list query
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## D-Trading Post — Dashboard Button Always Goes to /admin
**Date:** 2026-03-03
**Change:** All "Dashboard" links across entire site (nav, footer sitemap, admin page footer) now hardcoded to `/admin`. Also `/dashboard` route redirects admin users (`user.role === 'admin'`) to `/admin` immediately, covering the login→redirect flow.
**Removed:** Dashboard link from both footer instances (public sitemap footer line 1250, admin page footer)
**File:** `/media/Storage/server-flies/apps/dtrading-post/worker.js`

---

## map.dimaseinc.org — SmartCloud Scraper Not Logging In
**Date:** 2026-03-03
**Symptom:** Map server logs show `Login failed - redirected to https://pioneer.smartcloud.center/` every 30s; Active WOs: 0
**Root cause:** `docker-compose.yml` had `SMARTCLOUD_USER=cdimase` (lowercase c) but actual username is `Cdimase` (capital C)
**Fix:** `sed -i 's/SMARTCLOUD_USER=cdimase/SMARTCLOUD_USER=Cdimase/'` in docker-compose.yml, then `docker compose up -d --force-recreate`
**Result:** Login succeeded, 66 active work orders scraped immediately
**File:** `/media/Storage/map-server/docker-compose.yml`

---

## map.dimaseinc.org — Active WOs Count = 0 Despite 66 Scraped
**Date:** 2026-03-03
**Symptom:** Map shows 1268 locations but "Active WOs: 0" — work orders exist in DB but not counted
**Root causes:**
1. Scraper used `cells[2]` for WO status — actual status is in `cells[5]` (SmartCloud table column order: 0=customer, 1=date, 2=None, 3=description, 4=city, 5=status)
2. Statuses in DB were `'None'` or date strings like `'03/04/2026'` — none matched `isActive()` check
3. Frontend `isActive()` only checked strings like 'active','open' — not SmartCloud's values ('Future','Normal','Critical')
**Fixes:**
1. `scraper.py`: changed cell index `cells[2]` → `cells[5]` for status extraction
2. `index.html isActive()`: added `if (wo.is_active === 1) return true` as primary check + added 'future','normal','critical','critical-top customer' to recognized statuses
3. Bonus: reduced WO dot scale 10→6, location dot 6→4; new WOs bounce for 2s; completed WO markers removed from map on SSE update
**Files:** `/media/Storage/map-server/scraper.py`, `/media/Storage/map-server/static/index.html`

## DiMaseHome Ecosystem Expansion (2026-03-03)
- Added 4 new Quick Action tiles: Locksmith Admin, Podcast/Sub, Jellyfin, Learning Admin (anchor scroll)
- Users & Standings expanded to 6 tables: DiMase Inc. Members, D-Trading Post, Locksmith Customers, DiMase Learning Users, Podcast & Site Subscribers (active/trial filter), Jellyfin Media Users
- Added DiMase Learning Admin section (id=learning-admin): class CRUD for Axis AI + Chatbot Builder tracks, user progress table
- Added LOCKSMITH_DB binding (dimase-locksmith DB) to DiMaseHome wrangler.toml
- Added JELLYFIN_API_KEY secret to DiMaseHome (same key as dimaseinc-website)
- New routes: /admin/locksmith-delete, /admin/lms/class-create, /admin/lms/class-toggle, /admin/lms/class-delete
- fetchLocksmithRequests, fetchLmsData, fetchJellyfinUsers functions added
- Jellyfin users fetched via GET https://jellyfin.dimaseinc.org/Users with X-Emby-Token header

## Axis-nexus shell_exec + docker_ops fixed (2026-03-03)
- nexus.py was calling tools.run_shell() and tools.docker_architect() — old method names
- ToolController actual methods: _shell_exec(cmd: str) async, _docker_ops(action, name) async
- Fixed dispatch to: await tools._shell_exec(str(cmd)) and await tools._docker_ops(action, container)
- Also fixed /stats endpoint sync docker call → async _docker_ops

## Disk cleanup (2026-03-03)
- / was at 71% → now 55% after: apt autoremove (~700MB), docker system prune -f (~5.3GB)

## DiMaseHome D-Trading Package Tracking (2026-03-03)
- New section between D-Trading Stats and Docker
- fetchDtradingShipments() queries transactions JOIN listings JOIN users
- Carrier tracking URLs: USPS/UPS/FedEx/DHL/ONTRAC; fallback Google search
- Status summary: awaiting / in transit / delivered counts

---

## dimaseinc.org Login Loop — Missing subscription_plan Column (2026-03-03)
**Symptom:** Login form submits but nothing happens — infinite redirect back to /login
**Root cause:** `getSiteSession()` selected `u.subscription_plan` from D1 `users` table, but the column didn't exist — SQLite threw an error caught silently → returned null → every request redirected to /login
**Fix:** Run on D1 dimaseinc-learning:
```sql
ALTER TABLE users ADD COLUMN subscription_plan TEXT DEFAULT 'site';
UPDATE users SET subscription_plan='admin' WHERE is_admin=1;
```
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js` — getSiteSession query

---

## DiMaseHome "Error: Failed to Fetch" on Load — usb_config Table Missing (2026-03-03)
**Symptom:** DiMaseHome dashboard showed "Error: Failed to fetch" on page load
**Root cause:** DiMaseHome queries `usb_config` table in LEARNING_DB for USB key status, but table was never created
**Fix:** Run on D1 dimaseinc-learning:
```sql
CREATE TABLE IF NOT EXISTS usb_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO usb_config (key, value) VALUES ('usb_lost', 'false');
```

---

## Podcast Studio: "Error 404" on Start/Stop Recording (2026-03-03)
**Symptom:** Clicking "Start" or "Stop" in DiMaseHome Podcast Studio returns Error 404
**Root cause:** `path.slice(7)` on path `/studio/start` extracts `/start` (with leading slash), but the switch/match checks for `"start"` (no slash). No case matched → fell through to 404.
**Fix:** Changed `path.slice(7)` → `path.slice(8)` in DiMaseHome worker.js studio handler
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`

---

## Podcast Studio: "No Episodes Yet" — Column Name Mismatch (2026-03-03)
**Symptom:** DiMaseHome Podcast Studio episodes table showed "No episodes yet" despite episodes existing
**Root cause:** DiMaseHome queried `audio_file` column but `podcast_episodes` table uses `audio_url` and `filename` columns
**Fix:** Updated SELECT and INSERT queries to use correct column names:
- `SELECT id, episode_number, title, audio_url, filename, pub_date FROM podcast_episodes`
- `audio_url` = full https URL, `filename` = bare filename only
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`

---

## DiMaseHome: Wrangler Build Failure — Backtick Inside Backtick Template (2026-03-03)
**Symptom:** `npx wrangler deploy` fails with "Expected ';' but found 'style'" or similar parse error
**Root cause:** JS functions using template literals (backtick strings) placed inside a parent function that also returns a template literal — esbuild parser chokes on nested backticks
**Fix:** Any JS functions inside Podcast Studio card (or any card HTML) MUST use `var`, `function(){}` keyword syntax, and string concatenation (`+`) instead of template literals. Never use arrow functions or backtick strings inside those JS blocks.
**Pattern:** Replace `` files.map((f,i) => `...${f.name}...`) `` with `files.forEach(function(f,i){ html += '...' + f.name + '...'; })`
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`

---

## DiMaseHome: Audio Editor Added to Podcast Studio (2026-03-03)
**What:** Full in-browser audio editor in the Recording column of Podcast Studio
**Features:** Waveform display (Web Audio API canvas), trim start/end with yellow markers, background music mixer (voice vol + music vol sliders), Preview Trimmed, Preview Mix, Mix & Download (WAV), Mix & Upload
**JS functions added:** loadLatestAndPlay, openEditor, closeEditor, loadEditorAudio, drawWaveform, updateTrimMarkers, loadMusicFile, previewTrimmed, previewMix, renderMix (OfflineAudioContext), audioBufferToWav (RIFF header encoder), exportMix
**Also added:** Recordings Library section — loads mp3/wav file list from rec-api, play/use buttons per file
**New DiMaseHome routes:** POST /studio/files (proxies to rec-api /list), GET /studio/audio/* (proxies to rec-api /audio/*)
**New rec-api endpoint:** GET /list — returns JSON array of {filename, size, modified} for files in PODCAST_DIR
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`, `/usr/local/bin/podcast-rec-api.py`

---

## axis-monitor: CPU Always Shows 100% on Single-Core VPS (2026-03-03)
**Symptom:** DiMaseHome infrastructure panel showed CPU at 100% constantly
**Root cause:** `get_system_stats()` used `load_avg_1min / ncpu * 100`. Server has 1 CPU core — any load average ≥ 1.0 shows 100%. Load averages include I/O wait and aren't actual CPU utilization.
**Fix:** Replaced load-average calculation with `/proc/stat` 0.5-second sample:
```python
def _read_cpu():
    with open('/proc/stat') as f:
        vals = f.readline().split()[1:]
    user,nice,sys,idle,iowait,irq,softirq = [int(x) for x in vals[:7]]
    total = user+nice+sys+idle+iowait+irq+softirq
    return total, idle+iowait
t1, i1 = _read_cpu()
_time.sleep(0.5)
t2, i2 = _read_cpu()
dt = t2-t1; di = i2-i1
stats['cpu'] = round((1 - di/dt)*100, 1) if dt > 0 else 0
```
**Also:** Killed duplicate uvicorn process (PID 2682630), lowered vm.swappiness 60→10, dropped caches
**File:** `/root/axis-monitor/monitor.py`

---

## dimaseinc.org: Agent Zero + Terminal Pages Removed from Sitemap/Nav (2026-03-03)
**Symptom:** /ai and /terminal gate routes + axis.dimaseinc.org nav links present in site; /axis/chat-ui in sitemap submitted to Google
**Fix:**
- Removed `/terminal` and `/ai` from the `gates` object in worker.js (set `const gates = {}`)
- Removed `/axis/chat-ui` entry from /sitemap.xml generation
- Removed `<li><a href="https://axis.dimaseinc.org">Axis</a></li>` nav links from index.html, learning.html, computer-basics.html, map.html
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js` + all 4 HTML files

---

## dimaseinc.org: Hero Demo Video Added to Landing Page (2026-03-03)
**What:** Video animation placed between hero buttons and features grid on landing page
**Source:** `/home/dimase/Pictures/Video_Generation_Complete_phone.mp4` (7MB) → uploaded to server at `/media/Storage/website/dimaseinc-website/videos/hero-demo.mp4`
**HTML added:** `<section class="hero-video-section"><div class="hero-video-wrap"><video src="/videos/hero-demo.mp4" autoplay loop muted playsinline class="hero-video"></video></div></section>`
**CSS:** `.hero-video-section` (centered container), `.hero-video-wrap` (inline-block, border-radius, gold glow box-shadow), `.hero-video` (max-width 320px, rounded corners)
**Served as:** Cloudflare Workers static asset from `videos/` directory
**File:** `/media/Storage/website/dimaseinc-website/src/worker.js`

---

## dimaseinc.org: "Build Your Own Chatbot" Class Added to LMS (2026-03-03)
**What:** New Chatbot Builder track class inserted directly into D1 via wrangler d1 execute
**SQL:**
```sql
INSERT INTO classes (track, title, description, duration_minutes, level, sort_order, is_published)
VALUES ('chatbot_builder', 'Build Your Own Chatbot', 'Learn to create and deploy your own AI chatbot from scratch using DiMase platform tools.', 50, 'intermediate', 21, 1);
```
**DB:** dimaseinc-learning (af4b58c4-5553-4d4f-8af2-53cdf1c39e34)

---

## DiMaseHome: USB LOST Button "Failed to Fetch" — CORS + Credentials (2026-03-04)
**Symptom:** Clicking "USB KEY LOST" in DiMaseHome showed "Failed to fetch" alert
**Root cause:** JS fetched `https://dimaseinc.org/auth/usb-toggle` with `credentials:"include"` from a different origin (home.dimaseinc.org). Browsers require `Access-Control-Allow-Credentials: true` + explicit `Access-Control-Allow-Origin: <origin>` (not `*`) for credentialed cross-origin fetches. The endpoint only returned `Access-Control-Allow-Origin: *` → CORS block → "Failed to fetch".
**Fix:** Added `/admin/usb-status` and `/admin/usb-toggle` routes directly to DiMaseHome worker (same-origin). Both use DiMaseHome's own `requireAuth` + `LEARNING_DB` binding directly. Updated JS to fetch `/admin/usb-toggle` and `/admin/usb-status` (relative URLs).
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`
**Note:** After deploy, browser must hard-refresh (Ctrl+Shift+R) to clear cached JS.

---

## DiMaseHome: Stalled HTTP Response Warning (2026-03-04)
**Symptom:** CF Worker logs show "A stalled HTTP response was canceled to prevent deadlock"
**Root cause:** `fetchWithTimeout()` fetches service URLs to check health but only reads `res.status` — never reads or cancels the response body. With 9 services checked in parallel via `Promise.allSettled`, all 9 bodies sit unread, hitting CF's concurrent in-flight request limit.
**Fix:** Added `res.body?.cancel()` in three places:
1. `fetchWithTimeout` — after reading status (main fix, called 9× per dashboard load)
2. `fetchPodcastEpisodes` — in the `else` branch when `!res.ok`
3. `fetchRecStatus` — after `!r.ok` check
**File:** `/media/Storage/server-flies/apps/dimasehome/worker.js`
**Rule:** Any `fetch()` in a CF Worker where you don't read the full body must call `res.body?.cancel()` to release the connection.

---

## LMS: CB Classes Duplicated + Wrong Label in DiMaseHome (2026-03-04)
**Symptom:** DiMaseHome showed "Chatbot Builder Track — 60 classes" but they were Computer Basics classes, all duplicated
**Root cause:** `cb_classes` table had 60 rows (30 duplicated via INSERT), DiMaseHome labeled it "Chatbot Builder" incorrectly. class #121 "Build Your Own Chatbot" was wrongly added to `classes` (AI Learning) table.
**Fix:**
```sql
DELETE FROM cb_classes WHERE id >= 31;  -- remove 30 duplicates, now 30 unique
DELETE FROM classes WHERE id = 121;     -- remove wrongly placed chatbot class
```
Renamed DiMaseHome label "Chatbot Builder Learning Track" → "Computer Basics Learning Track". Deployed DiMaseHome.

---

## Chatbot Builder: New Third LMS Track (2026-03-04)
**What:** Added `chatbot_classes` + `chatbot_progress` tables to `dimaseinc-learning` D1. 30 classes inserted (10 beginner/intermediate/advanced). API at `/chatbot/` prefix. Frontend section added to learning.html.
**DB tables:**
```sql
CREATE TABLE chatbot_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, sort_order INTEGER DEFAULT 0, title TEXT, subtitle TEXT, description TEXT, content_outline TEXT, objectives TEXT, exercises TEXT, agent_zero_prompt TEXT, duration_minutes INTEGER DEFAULT 30, is_published INTEGER DEFAULT 1);
CREATE TABLE chatbot_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, class_id INTEGER, completed INTEGER DEFAULT 0, completed_at TEXT, UNIQUE(user_id, class_id));
```
**Worker function:** `handleChatbotBuilderApi(request, env, url)` at top level, called via `if (url.pathname.startsWith('/chatbot/'))` in main handler.
**Helper names:** `apiResponse(data, status)` and `verifyApiToken(request.headers.get('Authorization'), env)` — NOT jsonResponse / verifySessionToken.

---

## dimaseinc.org Worker 1101 — Chatbot Routes Wrong Scope (2026-03-04)
**Symptom:** Every request to dimaseinc.org returned Error 1101 "Worker threw exception"
**Root cause:** Patch script injected chatbot routes as top-level statements in the main `fetch()` handler, referencing `path` and `method` variables — which are ONLY defined inside individual handler functions like `handleLearningApi()`. This caused `ReferenceError` on every request.
**Fix:** Extracted chatbot routes into a proper `handleChatbotBuilderApi(request, env, url)` function (defines its own `path`/`method` at line 1357). Removed orphaned routes. Added routing: `if (url.pathname.startsWith('/chatbot/')) { return handleChatbotBuilderApi(...) }`.
**Rule:** In CF Workers, `path` and `method` vars are local to each handler function — never reference them from the main `fetch()` scope.

---

## Local Deploy Missing Assets — learning.html 404 After Deploy (2026-03-04)
**Symptom:** `learning.html` returned 404 after deploying from `/tmp/deploy_chatbot/` (only had worker.js)
**Root cause:** `wrangler.jsonc` has `"assets": { "directory": "./" }`. When deploying from a temp dir with only `src/worker.js` + `wrangler.jsonc`, the assets binding has no HTML files → ASSETS.fetch() returns 404 for any `.html` request.
**Fix:** Always `rsync` the full website dir before local deploy:
```bash
rsync -av buyvm:/media/Storage/website/dimaseinc-website/ /tmp/deploy_chatbot/ --exclude='node_modules' --exclude='.wrangler'
mkdir -p /tmp/deploy_chatbot/src
cp /tmp/deploy_chatbot/worker.js /tmp/deploy_chatbot/src/worker.js
cd /tmp/deploy_chatbot && WRANGLER_CONFIG_PATH=/home/dimase/.config/.wrangler/config/default.toml npx wrangler deploy
```

---

## dimaseinc.org Site Login — Password Hash is PBKDF2 Not Bcrypt (2026-03-04)
**Symptom:** Password reset via `UPDATE users SET password_hash = '<bcrypt>'` didn't work — login still failed
**Root cause:** `hashPassword()` in worker.js uses PBKDF2 via `crypto.subtle` with a per-user `salt` column — NOT bcrypt. Setting a bcrypt hash directly in the DB never matches.
**Fix:** Generate correct hash using node on server:
```bash
node -e "
const salt = '<USER_SALT_FROM_DB>';
const password = 'NewPassword';
const encoder = new TextEncoder();
crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  .then(key => crypto.subtle.deriveBits({name:'PBKDF2', salt: encoder.encode(salt), iterations:100000, hash:'SHA-256'}, key, 256))
  .then(bits => console.log(Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('')));
"
```
Then `UPDATE users SET password_hash = '<hash>' WHERE email = '...'`
**Admin account:** mrcdimase@gmail.com, salt: c01b2819-4c47-42df-9240-30d42622eaad, password: Ruffieno

---

## learning.html: "Cannot read properties of null (reading 'style')" on Login (2026-03-04)
**Symptom:** In-page LMS login at `/learning#auth` showed JS error after signing in
**Root cause:** `onAuthSuccess()` called `document.getElementById('adminNavBtn').style.display = ''` — but the `adminNavBtn` button element was previously removed from the HTML (purple Admin Panel button removal).
**Fix:** Replaced the two `.style.display` lines referencing `adminNavBtn` with `// adminNavBtn removed` comments.
**File:** `/media/Storage/website/dimaseinc-website/learning.html` (lines 2768, 2770)

---

## learning.html: Chatbot Builder 0/0 Classes (Missing JS Functions) (2026-03-04)
**Symptom:** Chatbot Builder level cards showed 0/0 Complete — classes existed in DB but not rendering
**Root cause:** `patch_chatbot_track.py` failed to insert the JS functions into learning.html. Missing:
- `let chatbotClassesCache = {}` and `let chatbotProgressCache = []` variable declarations
- `updateChatbotProgressRings()` function
- `openChatbotLevel(level)` function
- `renderChatbotClassList()` function
**Fix:** Added all missing declarations and functions directly via Python patch. Functions inserted before `updateCbProgressRings()`.
**File:** `/media/Storage/website/dimaseinc-website/learning.html`

---

## Telegram Bot "Simulated Access" — system_override Field Ignored (2026-03-10)
**Symptom:** axis-nexus sent `system_override` in the POST body to the worker.js bot-chat handler, but the worker only read the `system` field — so the override was silently dropped and the bot used the default system prompt.
**Root cause:** worker.js bot-chat handler destructured only `{ message, system, context }` from the request body; `system_override` was never read.
**Fix:** Added `system_override` to the destructuring in worker.js bot-chat handler and added fallback: `const effectiveSystem = system_override || system || defaultSystemPrompt`.

---

## Bot Announcing Commands Instead of Acting Silently (2026-03-10)
**Symptom:** Axis AI bot would say things like "I will now run a shell command to check..." before actually executing, which was verbose and broke the UX.
**Root cause:** Neither nexus.py nor worker.js system prompts instructed the AI to act without announcing its steps.
**Fix:** Added "NEVER announce what you are about to do. Just use the tool and report the outcome." to the system prompt in both nexus.py and worker.js bot-chat handler.

---

## Typing/Chatbot Classlist Spinner Stuck Forever (2026-03-10)
**Symptom:** Opening the Typing Mastery or Chatbot Builder class list view left the loading spinner spinning indefinitely — classes never rendered.
**Root cause:** `renderTypingClassList()` and `renderChatbotClassList()` called `document.getElementById('classListContainer')` which does not exist in the DOM. The real container ID is `classTimeline`. The functions hit `if (!container) return` immediately, aborting before rendering anything.
**Fix:** Changed both functions to use `document.getElementById('classTimeline')`.

---

## LMS Pages Require Separate Login (Typing/Learning/Reading) (2026-03-10)
**Symptom:** Users already logged into dimaseinc.org were prompted to log in again when visiting typing.html, learning.html, or reading.html — each page checked its own localStorage token (`typing_token`, `learning_token`, `reading_token`) which wasn't set.
**Root cause:** Each LMS page's `checkAuth()` only looked at its own localStorage key. Site-wide session cookie was not used.
**Fix:** Added `/auth/lms-token` GET endpoint to worker.js that exchanges the site session cookie for a signed JWT. Each page's `checkAuth()` now auto-fetches this endpoint when no local token is found, stores the returned JWT, and proceeds without showing a login prompt.

---

## Typing Class Click Does Nothing — openClass Undefined (2026-03-10)
**Symptom:** Clicking a class row in the Typing Mastery or Chatbot Builder classlist did nothing — no panel opened, no error visible.
**Root cause:** `renderTypingClassList` and `renderChatbotClassList` emitted `onclick="openClass(id)"` but `openClass()` was never defined anywhere in the page.
**Fix:** Added `openClass(id)` dispatcher function that routes to `openTypingClass(id)` or `openChatbotClass(id)` based on the active track. Added `openTypingClass(id)` which loads the class from cache, shows the `typingExercisePanel`, and wires the Mark Complete button to POST `/typing/progress`.

---

## Class-Specific Typing Sentences Not Loading (2026-03-10)
**Symptom:** All typing classes showed the same generic drill sentences regardless of which class was opened.
**Root cause:** `teGetSentence()` had no per-class override mechanism — it always pulled from the generic sentence pool.
**Fix:** Added `TYPING_CLASS_SENTENCES` object (keyed by class ID 1–30) with 3 drill sentences per class. Home row classes use ASDF-focused drills; programming classes use real code snippets. `teGetSentence()` now checks `teClassOverrideSentences` first before falling back to the generic pool.

---

## Learning Page Blank — Apostrophe in Single-Quoted JS String (2026-03-10)
**Symptom:** learning.html rendered completely blank after a patch that added class sentences.
**Root cause:** Class 27 sentence contained apostrophes inside a single-quoted JS string: `'He said, "I'll be there..."'`. The apostrophe in `I'll` terminated the string early, producing a syntax error that silently killed the entire script.
**Fix:** Rewrote the sentence to avoid apostrophes. Going forward: always use double-quoted strings or template literals for sentences that may contain apostrophes, or escape with `\'`.
**Prevention:** Run `node --check learning.html` (or extract the `<script>` block and check it) before deploying any patch that modifies inline JS strings.

---

## Reading Classlist Shows Raw Template Code `${...}` (2026-03-10)
**Symptom:** Reading Mastery class list displayed literal text like `${idx+1}` instead of interpolated values.
**Root cause:** A previous patch script escaped template literal expressions as `\${idx+1}` — the backslash prevented interpolation, so the raw string was rendered verbatim in the browser.
**Fix:** Removed the backslashes so `${idx+1}` interpolated correctly inside the template literal in `renderReadingClassList`.

---

## Local Machine: Power Button Shutdown + WoL + Browser VNC (2026-03-12)

### Power Button → Full Shutdown (not suspend)
**Problem:** Power key on keyboard triggered suspend instead of clean poweroff.
**Fix:**
```bash
gsettings set org.gnome.settings-daemon.plugins.power power-button-action 'nothing'
sudo mkdir -p /etc/systemd/logind.conf.d
echo -e "[Login]\nHandlePowerKey=poweroff\nPowerKeyIgnoreInhibited=yes" | sudo tee /etc/systemd/logind.conf.d/powerkey.conf
sudo systemctl restart systemd-logind
```
**Note:** `DefaultTimeoutStopSec=15s` already set in /etc/systemd/system.conf — prevents shutdown hangs.

### Wake-on-LAN Setup
**Goal:** Wake local machine remotely via DiMaseHome.
**Fix:**
```bash
# Enable WoL on eno2
sudo ethtool -s eno2 wol g
# Persist via udev rule
echo 'ACTION=="add", SUBSYSTEM=="net", NAME=="eno2", RUN+="/usr/sbin/ethtool -s eno2 wol g"' | sudo tee /etc/udev/rules.d/81-wol.rules
```
**Router required:** Forward UDP port 9 → 10.0.0.241 on home router for WoL from internet.
**BuyVM relay:** /root/wol-relay.py on port 9191, secret in /root/wol-relay.env, exposed via wol-relay.dimaseinc.org CF tunnel.
**DiMaseHome:** Wake Local PC button → POST /admin/wake-local → handleWakeLocal() → wol-relay.

### Browser VNC (Local Desktop Access)
**Goal:** Access local GNOME desktop from browser via DiMaseHome → local-vnc.dimaseinc.org.
**Stack:** gnome-remote-desktop (RDP port 3389) → Guacamole Docker (port 8080) → cloudflared-local tunnel → local-vnc.dimaseinc.org
**Setup:**
```bash
# Generate RDP cert
openssl req -x509 -newkey rsa:4096 -keyout ~/.local/share/gnome-remote-desktop/rdp-tls.key \
  -out ~/.local/share/gnome-remote-desktop/rdp-tls.crt -days 3650 -nodes -subj "/CN=local-desktop"
grdctl rdp set-tls-cert ~/.local/share/gnome-remote-desktop/rdp-tls.crt
grdctl rdp set-tls-key ~/.local/share/gnome-remote-desktop/rdp-tls.key
grdctl rdp set-credentials dimase Ruffieno260
grdctl rdp disable-view-only
grdctl rdp enable
systemctl --user enable --now gnome-remote-desktop

# Guacamole Docker
sudo docker run -d --name guacamole --network host --restart unless-stopped \
  -e EXTENSIONS=auth-quickconnect oznu/guacamole

# cloudflared tunnel (already created: 035a3091-8709-4147-9880-07aa8ebf7fc0)
# Config: /home/dimase/.cloudflared/local-desktop.yml → localhost:8080
# Service: /etc/systemd/system/cloudflared-local.service
sudo systemctl enable --now cloudflared-local
```
**First-time Guacamole setup:** Login guacadmin/guacadmin → Admin → Connections → New Connection → RDP, hostname: localhost, port: 3389, user: dimase, pass: Ruffieno260.
**Note:** gnome-remote-desktop is a USER systemd service — must be enabled via `systemctl --user`. It only runs when dimase is logged in to GNOME.
