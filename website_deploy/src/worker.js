const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const VALID_USER = 'DiMase';
// SHA-256 of "355314"
const VALID_PASS_HASH = 'dde3d6c5693ca91b69b41a463e8c7162d80ccd3f000ecd866c5fcce29d9f9eeb';
const SESSION_SECRET = 'dmsinc-terminal-session-2026';

async function sha256(message) {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSessionToken(user, isAdmin = false) {
  const ts = Date.now();
  const sig = await sha256(`${user}:${ts}:${isAdmin}:${SESSION_SECRET}`);
  return btoa(JSON.stringify({ user, ts, isAdmin, sig }));
}

async function validateSession(cookie) {
  if (!cookie) return null;
  try {
    const token = JSON.parse(atob(cookie));
    if (Date.now() - token.ts > 3600000) return null;
    const expected = await sha256(`${token.user}:${token.ts}:${!!token.isAdmin}:${SESSION_SECRET}`);
    if (token.sig !== expected) return null;
    return { user: token.user, isAdmin: !!token.isAdmin };
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

// Learning API helpers
function apiResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS
    }
  });
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createApiToken(userId, email, env, isAdmin = false) {
  const payload = { userId, email, isAdmin, exp: Date.now() + 7 * 24 * 3600000 };
  const data = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(data) + '.' + sigHex;
}

async function verifyApiToken(authHeader, env) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const [dataB64, sigHex] = token.split('.');
  if (!dataB64 || !sigHex) return null;
  try {
    const data = atob(dataB64);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload = JSON.parse(data);
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// --- SITE AUTH (subscription-based, D1 sessions) ---
const SITE_TRIAL_DAYS = 7;

async function createSiteSession(userId, env) {
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expires).run();
  return id;
}

async function getSiteSession(request, env) {
  const sid = getCookie(request, 'site_session');
  if (!sid) return null;
  try {
    return await env.DB.prepare(
      'SELECT s.id AS sid, u.id, u.email, u.display_name, u.subscription_status, u.subscription_plan, u.trial_end, u.next_billing_date, u.is_admin FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime("now")'
    ).bind(sid).first() || null;
  } catch { return null; }
}

async function jellyfinCreateUser(username, password, email, env) {
  if (!env.JELLYFIN_API_KEY) return null;
  try {
    const r = await fetch(`https://jellyfin.dimaseinc.org/Users/New?apiKey=${env.JELLYFIN_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Name: username, Password: password }),
    });
    if (r.ok) { const d = await r.json(); return d.Id || null; }
  } catch {}
  return null;
}

async function paypalGetToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return null;
  const base = env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  try {
    const r = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const d = await r.json();
    return d.access_token || null;
  } catch { return null; }
}

async function paypalVerifySub(subId, env) {
  const token = await paypalGetToken(env);
  if (!token) return null;
  const base = env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  try {
    const r = await fetch(`${base}/v1/billing/subscriptions/${subId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function isAccessAllowed(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  const s = user.subscription_status;
  if (s === 'grandfathered' || s === 'active') return true;
  if (s === 'trial' && user.trial_end) {
    const d = user.trial_end.endsWith('Z') ? user.trial_end : user.trial_end + 'Z';
    return new Date(d) > new Date();
  }
  return false;
}

// CORS-enabled API response for unified endpoints (allows any origin)
function corsApiResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS
    }
  });
}

// --- UNIFIED AUTH HANDLER (for DiMase AI and any future apps) ---
async function handleUnifiedAuth(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/auth/register' && method === 'POST') {
    try {
      const { email, password, displayName } = await request.json();
      if (!email || !password || !displayName) return corsApiResponse({ error: 'Missing fields' }, 400);
      if (password.length < 6) return corsApiResponse({ error: 'Password must be at least 6 characters' }, 400);
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
      if (existing) return corsApiResponse({ error: 'Email already registered' }, 409);
      const salt = crypto.randomUUID();
      const passwordHash = await hashPassword(password, salt);
      const result = await env.DB.prepare('INSERT INTO users (email, password_hash, salt, display_name) VALUES (?, ?, ?, ?)').bind(email.toLowerCase(), passwordHash, salt, displayName).run();
      const userId = result.meta.last_row_id;
      const token = await createApiToken(userId, email.toLowerCase(), env, false);
      return corsApiResponse({ token, user: { id: userId, email: email.toLowerCase(), displayName, isAdmin: false } });
    } catch (e) {
      return corsApiResponse({ error: 'Registration failed' }, 500);
    }
  }

  if (path === '/auth/login' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return corsApiResponse({ error: 'Missing fields' }, 400);
      const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first();
      if (!user) return corsApiResponse({ error: 'Invalid credentials' }, 401);
      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.password_hash) return corsApiResponse({ error: 'Invalid credentials' }, 401);
      const token = await createApiToken(user.id, user.email, env, !!user.is_admin);
      return corsApiResponse({ token, user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
    } catch (e) {
      return corsApiResponse({ error: 'Login failed' }, 500);
    }
  }

  if (path === '/auth/me' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return corsApiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT id, email, display_name, is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user) return corsApiResponse({ error: 'User not found' }, 404);
    return corsApiResponse({ user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
  }

  // Auto-auth: exchange site session cookie for a JWT token (used by LMS pages)
  if (path === '/auth/lms-token' && method === 'GET') {
    const su = await getSiteSession(request, env);
    if (!su) return corsApiResponse({ error: 'No site session' }, 401);
    const user = await env.DB.prepare('SELECT id, email, display_name, is_admin FROM users WHERE id = ?').bind(su.id).first();
    if (!user) return corsApiResponse({ error: 'User not found' }, 404);
    const token = await createApiToken(user.id, user.email, env, !!user.is_admin);
    return corsApiResponse({ token, user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
  }

  return null;
}

// --- DIMASE AI CHAT HANDLER ---

// Fallback chat using Cloudflare Workers AI when Agent Zero is unavailable
async function handleChatFallback(message, context, env, request) {
  const cfData = (request && request.cf) || {};
  const now = new Date();
  const realTimeInfo = [
    `Current date/time: ${now.toISOString()} (UTC)`,
    cfData.timezone ? `User timezone: ${cfData.timezone}` : '',
    cfData.city ? `User location: ${cfData.city}, ${cfData.region || ''}, ${cfData.country || ''}` : '',
  ].filter(Boolean).join('. ');
  let basePrompt = context;
  if (!basePrompt && env.DB) {
    try {
      const row = await env.DB.prepare('SELECT value FROM dimase_config WHERE key = ?').bind('system_prompt').first();
      if (row) basePrompt = row.value;
    } catch {}
  }
  basePrompt = basePrompt || 'You are DiMase, a powerful AI assistant created by DiMase Inc. You help manage, maintain, and secure the DiMase Inc. platform. You are helpful, direct, and honest — you acknowledge when you lack information rather than fabricating answers.';
  const systemPrompt = basePrompt + '\n\n' + realTimeInfo;
  try {
    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 2048,
    });
    const reply = result.response || (typeof result === 'string' ? result : JSON.stringify(result));
    return corsApiResponse({
      response: reply,
      chatId: null,
      model: 'llama-3.1-8b',
      provider: 'cloudflare-ai',
    });
  } catch (fallbackErr) {
    return corsApiResponse({ error: 'AI service unavailable', details: fallbackErr.message }, 502);
  }
}

async function handleDiMaseChat(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/dimase/chat' && method === 'POST') {
    // Accept auth token from Authorization header OR from request body
    let body;
    try {
      body = await request.json();
    } catch {
      return corsApiResponse({ error: 'Invalid JSON body' }, 400);
    }

    const { message, token: bodyToken, chatId, context } = body;

    // Try Bearer header first, then body token
    let authHeader = request.headers.get('Authorization');
    if (!authHeader && bodyToken) {
      authHeader = 'Bearer ' + bodyToken;
    }

    const payload = await verifyApiToken(authHeader, env);
    if (!payload) return corsApiResponse({ error: 'Unauthorized' }, 401);

    if (!message) return corsApiResponse({ error: 'Missing message' }, 400);

    try {
      const agentZeroUrl = 'https://dimase.dimaseinc.org';

      // Authenticate with Agent Zero (with timeout)
      let loginRes;
      try {
        const loginController = new AbortController();
        const loginTimeout = setTimeout(() => loginController.abort(), 10000);
        loginRes = await fetch(agentZeroUrl + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'username=DiMase&password=admin',
          redirect: 'manual',
          signal: loginController.signal,
        });
        clearTimeout(loginTimeout);
      } catch (loginErr) {
        // Agent Zero unreachable -- use fallback
        return handleChatFallback(message, context, env, request);
      }

      const setCookieHeader = loginRes.headers.get('Set-Cookie') || '';
      const sessionCookieMatch = setCookieHeader.match(/([^;]+)/);
      const sessionCookie = sessionCookieMatch ? sessionCookieMatch[1] : '';
      if (!sessionCookie) {
        // Agent Zero login failed -- use fallback
        return handleChatFallback(message, context, env, request);
      }

      // Get CSRF token
      let csrfRes;
      try {
        const csrfController = new AbortController();
        const csrfTimeout = setTimeout(() => csrfController.abort(), 10000);
        csrfRes = await fetch(agentZeroUrl + '/csrf_token', {
          method: 'GET',
          headers: { 'Cookie': sessionCookie },
          signal: csrfController.signal,
        });
        clearTimeout(csrfTimeout);
      } catch (csrfErr) {
        return handleChatFallback(message, context, env, request);
      }

      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.token || csrfData.csrf_token || '';
      if (!csrfToken) {
        return handleChatFallback(message, context, env, request);
      }
      const csrfSetCookie = csrfRes.headers.get('Set-Cookie') || '';
      const csrfCookieMatch = csrfSetCookie.match(/([^;]+)/);
      const updatedCookie = csrfCookieMatch ? csrfCookieMatch[1] : sessionCookie;

      const authHeaders = {
        'Content-Type': 'application/json',
        'Cookie': updatedCookie,
        'X-CSRF-Token': csrfToken,
      };

      let contextId = chatId;

      if (!contextId) {
        // Create a new chat context
        const newContextGuid = crypto.randomUUID();
        const createRes = await fetch(agentZeroUrl + '/chat_create', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ current_context: '', new_context: newContextGuid }),
        });
        const createData = await createRes.json();
        if (!createData.ok) {
          // Agent Zero chat creation failed -- use fallback
          return handleChatFallback(message, context, env, request);
        }
        contextId = createData.ctxid || newContextGuid;

        // Build real-time context from Cloudflare request headers
        const cfData = request.cf || {};
        const now = new Date();
        const realTimeContext = [
          `Current date/time: ${now.toISOString()} (UTC)`,
          cfData.timezone ? `User timezone: ${cfData.timezone}` : '',
          cfData.city ? `User location: ${cfData.city}, ${cfData.region || ''}, ${cfData.country || ''}` : '',
          cfData.latitude && cfData.longitude ? `Coordinates: ${cfData.latitude}, ${cfData.longitude}` : '',
          `You have full agent capabilities: code execution (terminal, Python, Node.js), web search, browser automation, memory, file operations, scheduling, and subordinate agents. Use these tools freely to answer questions - fetch real-time weather, look up information, run calculations, etc.`,
        ].filter(Boolean).join('\n');

        // If context provided, prime the AI with it
        const systemPrompt = context || 'You are DiMase, a helpful AI assistant by DiMase Inc.';
        const combinedMessage = systemPrompt + '\n\n--- Real-time Information ---\n' + realTimeContext + '\n\n---\nUser message: ' + message;
        const msgRes = await fetch(agentZeroUrl + '/message', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ text: combinedMessage, context: contextId }),
        });
        const msgData = await msgRes.json();
        return corsApiResponse({
          response: msgData.message || msgData.response || msgData.content || '',
          chatId: contextId,
          model: 'dimase',
          provider: 'dimaseinc',
        });
      }

      // Existing chat -- send the message directly
      const msgRes = await fetch(agentZeroUrl + '/message', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: message, context: contextId }),
      });
      const msgData = await msgRes.json();

      return corsApiResponse({
        response: msgData.message || msgData.response || msgData.content || '',
        chatId: contextId,
        model: 'agent-zero',
        provider: 'dimaseinc',
      });
    } catch (e) {
      // Any unexpected error -- try fallback before giving up
      return handleChatFallback(message, context, env, request);
    }
  }

  return null;
}

// --- DIMASE AI MEDIA HANDLER (image generation, editing, video, description) ---
async function handleDiMaseMedia(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // All media endpoints require POST + auth
  if (method !== 'POST') return null;

  // Verify auth for all media endpoints
  let body;
  try {
    body = await request.json();
  } catch {
    return corsApiResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Try Bearer header first, then body token
  let authHeader = request.headers.get('Authorization');
  if (!authHeader && body.token) {
    authHeader = 'Bearer ' + body.token;
  }

  const payload = await verifyApiToken(authHeader, env);
  if (!payload) return corsApiResponse({ error: 'Unauthorized' }, 401);

  // --- POST /dimase/generate-image ---
  if (path === '/dimase/generate-image') {
    const { prompt, width, height, steps } = body;
    if (!prompt) return corsApiResponse({ error: 'Missing prompt' }, 400);

    const imgWidth = width || 1024;
    const imgHeight = height || 1024;
    const imgSteps = steps || 8;

    try {
      const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt: prompt,
        width: imgWidth,
        height: imgHeight,
        num_steps: imgSteps,
      });

      // The model returns raw image bytes as a ReadableStream or Uint8Array
      let imageBytes;
      if (result instanceof ReadableStream) {
        const reader = result.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        imageBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          imageBytes.set(chunk, offset);
          offset += chunk.length;
        }
      } else if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
        imageBytes = new Uint8Array(result);
      } else if (result && typeof result === 'object' && result.image) {
        // Some models return {image: base64string}
        return corsApiResponse({
          image: result.image.startsWith('data:') ? result.image : 'data:image/png;base64,' + result.image,
          prompt: prompt,
          width: imgWidth,
          height: imgHeight,
          steps: imgSteps,
        });
      } else {
        // Try to treat it as raw bytes
        imageBytes = new Uint8Array(result);
      }

      // Convert to base64
      let binary = '';
      for (let i = 0; i < imageBytes.length; i++) {
        binary += String.fromCharCode(imageBytes[i]);
      }
      const base64 = btoa(binary);

      return corsApiResponse({
        image: 'data:image/png;base64,' + base64,
        prompt: prompt,
        width: imgWidth,
        height: imgHeight,
        steps: imgSteps,
      });
    } catch (e) {
      return corsApiResponse({ error: 'Image generation failed', details: e.message }, 502);
    }
  }

  // --- POST /dimase/edit-image ---
  if (path === '/dimase/edit-image') {
    const { image, prompt, strength } = body;
    if (!prompt) return corsApiResponse({ error: 'Missing prompt' }, 400);

    const editStrength = strength || 0.75;

    try {
      // Use SDXL for image editing via text-to-image with detailed prompt
      // If an input image is provided, we describe the edit; otherwise pure generation
      let editPrompt = prompt;
      if (image) {
        // Enhance the prompt to guide the edit
        editPrompt = prompt;
      }

      const inputs = {
        prompt: editPrompt,
        guidance: 7.5 + (editStrength * 5), // Higher strength = more change
      };

      // If base image provided, try to pass it to the model
      if (image) {
        // Strip data URI prefix if present
        let imageData = image;
        if (imageData.startsWith('data:')) {
          imageData = imageData.split(',')[1];
        }

        // Try using image-to-image with the model
        try {
          inputs.image = [...Uint8Array.from(atob(imageData), c => c.charCodeAt(0))];
          inputs.strength = editStrength;
        } catch (decodeErr) {
          // If base64 decode fails, proceed with text-only generation
        }
      }

      const result = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', inputs);

      // Process result similar to generate-image
      let imageBytes;
      if (result instanceof ReadableStream) {
        const reader = result.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        imageBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          imageBytes.set(chunk, offset);
          offset += chunk.length;
        }
      } else if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
        imageBytes = new Uint8Array(result);
      } else if (result && typeof result === 'object' && result.image) {
        return corsApiResponse({
          image: result.image.startsWith('data:') ? result.image : 'data:image/png;base64,' + result.image,
          prompt: prompt,
          strength: editStrength,
        });
      } else {
        imageBytes = new Uint8Array(result);
      }

      let binary = '';
      for (let i = 0; i < imageBytes.length; i++) {
        binary += String.fromCharCode(imageBytes[i]);
      }
      const base64 = btoa(binary);

      return corsApiResponse({
        image: 'data:image/png;base64,' + base64,
        prompt: prompt,
        strength: editStrength,
      });
    } catch (e) {
      return corsApiResponse({ error: 'Image editing failed', details: e.message }, 502);
    }
  }

  // --- POST /dimase/image-to-video ---
  if (path === '/dimase/image-to-video') {
    const { image, duration, effect } = body;
    if (!image) return corsApiResponse({ error: 'Missing image' }, 400);

    const videoDuration = duration || 3000; // milliseconds
    const animEffect = effect || 'zoom-in';
    const validEffects = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'fade', 'pulse'];

    if (!validEffects.includes(animEffect)) {
      return corsApiResponse({
        error: 'Invalid effect. Valid effects: ' + validEffects.join(', ')
      }, 400);
    }

    try {
      // Cloudflare Workers AI doesn't have video generation models,
      // so we return the original image with animation instructions
      // that the client (Android app) can use to animate locally.

      // Ensure image data is properly formatted
      let imageData = image;
      if (!imageData.startsWith('data:')) {
        imageData = 'data:image/png;base64,' + imageData;
      }

      // Define animation parameters based on effect
      const animationParams = {
        'zoom-in': {
          type: 'scale',
          from: { scale: 1.0 },
          to: { scale: 1.3 },
          easing: 'ease-in-out',
        },
        'zoom-out': {
          type: 'scale',
          from: { scale: 1.3 },
          to: { scale: 1.0 },
          easing: 'ease-in-out',
        },
        'pan-left': {
          type: 'translate',
          from: { x: 0, y: 0 },
          to: { x: -0.2, y: 0 },
          easing: 'linear',
        },
        'pan-right': {
          type: 'translate',
          from: { x: 0, y: 0 },
          to: { x: 0.2, y: 0 },
          easing: 'linear',
        },
        'fade': {
          type: 'opacity',
          from: { opacity: 0.0 },
          to: { opacity: 1.0 },
          easing: 'ease-in',
        },
        'pulse': {
          type: 'scale',
          from: { scale: 1.0 },
          to: { scale: 1.1 },
          easing: 'ease-in-out',
          repeat: true,
          repeatCount: Math.max(1, Math.floor(videoDuration / 1000)),
        },
      };

      return corsApiResponse({
        image: imageData,
        animation: {
          effect: animEffect,
          duration: videoDuration,
          fps: 30,
          params: animationParams[animEffect],
        },
        supportedEffects: validEffects,
        aiVideoAvailable: true,
        aiVideoEndpoint: '/dimase/video-generate',
      });
    } catch (e) {
      return corsApiResponse({ error: 'Image-to-video processing failed', details: e.message }, 502);
    }
  }

  // --- POST /dimase/video-generate (real AI image-to-video) ---
  if (path === '/dimase/video-generate') {
    const { image, motion, seed } = body;
    if (!image) return corsApiResponse({ error: 'Missing image' }, 400);

    try {
      // Strip base64 data URI prefix to get raw base64 string
      let rawBase64 = image;
      if (rawBase64.startsWith('data:')) {
        rawBase64 = rawBase64.split(',')[1];
      }

      // Decode base64 to binary Uint8Array
      const binaryString = atob(rawBase64);
      const imageBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageBytes[i] = binaryString.charCodeAt(i);
      }

      // Attempt HuggingFace Stable Video Diffusion (free, no API key needed)
      let hfResponse;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

        hfResponse = await fetch(
          'https://api-inference.huggingface.co/models/stabilityai/stable-video-diffusion-img2vid-xt',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
            },
            body: imageBytes,
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);
      } catch (fetchErr) {
        // Fetch itself failed (timeout, network error) -- fall through to fallback
        hfResponse = null;
      }

      // If HuggingFace returned 200, we have MP4 video bytes
      if (hfResponse && hfResponse.ok) {
        const videoBuffer = await hfResponse.arrayBuffer();
        const videoBytes = new Uint8Array(videoBuffer);
        let videoBinary = '';
        for (let i = 0; i < videoBytes.length; i++) {
          videoBinary += String.fromCharCode(videoBytes[i]);
        }
        const videoBase64 = btoa(videoBinary);

        return corsApiResponse({
          video: 'data:video/mp4;base64,' + videoBase64,
          format: 'mp4',
          source: 'stable-video-diffusion',
          duration: 4,
        });
      }

      // If HuggingFace returned 503 (model loading), tell client to retry
      if (hfResponse && hfResponse.status === 503) {
        let estimatedTime = 60;
        try {
          const loadingData = await hfResponse.json();
          if (loadingData.estimated_time) {
            estimatedTime = Math.ceil(loadingData.estimated_time);
          }
        } catch {}

        return corsApiResponse({
          status: 'loading',
          message: 'Video model is loading, please try again in 30-60 seconds',
          estimatedTime: estimatedTime,
        }, 202);
      }

      // HuggingFace failed (500, 429, other errors, or fetch failed entirely)
      // Fall back to multi-frame generation using Cloudflare AI

      // Step 1: Describe the image using vision model
      let description = 'A detailed scene';
      try {
        const descResult = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
          messages: [
            {
              role: 'user',
              content: 'Describe this image concisely in one sentence, focusing on the main subject, action, and setting. Be specific.',
            }
          ],
          image: [...imageBytes],
        });
        description = descResult.response || descResult.description || (typeof descResult === 'string' ? descResult : description);
      } catch (descErr) {
        // If vision model fails, try the fallback vision model
        try {
          const descResult = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
            messages: [
              {
                role: 'user',
                content: 'Describe this image concisely in one sentence.',
              }
            ],
            image: [...imageBytes],
          });
          description = descResult.response || descResult.description || (typeof descResult === 'string' ? descResult : description);
        } catch {}
      }

      // Step 2: Build 6 progressive motion prompts
      const motionDesc = motion || 'gentle natural movement';
      const framePrompts = [
        `${description}, beginning of ${motionDesc}, first moment, photorealistic`,
        `${description}, slight ${motionDesc}, early motion, photorealistic`,
        `${description}, mid ${motionDesc}, halfway through movement, photorealistic`,
        `${description}, continued ${motionDesc}, building momentum, photorealistic`,
        `${description}, near end of ${motionDesc}, almost complete, photorealistic`,
        `${description}, full ${motionDesc} complete, final position, photorealistic`,
      ];

      // Step 3: Generate all 6 frames in parallel
      const framePromises = framePrompts.map(prompt =>
        env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt: prompt,
          width: 512,
          height: 512,
          num_steps: 4,
        })
      );
      const frameResults = await Promise.all(framePromises);

      // Step 4: Convert each frame to base64
      const frames = [];
      for (let i = 0; i < frameResults.length; i++) {
        const result = frameResults[i];
        let frameBytes;

        if (result instanceof ReadableStream) {
          const reader = result.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
          frameBytes = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            frameBytes.set(chunk, offset);
            offset += chunk.length;
          }
        } else if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
          frameBytes = new Uint8Array(result);
        } else if (result && typeof result === 'object' && result.image) {
          const imgData = result.image.startsWith('data:') ? result.image : 'data:image/png;base64,' + result.image;
          frames.push({ image: imgData, index: i });
          continue;
        } else {
          frameBytes = new Uint8Array(result);
        }

        let frameBinary = '';
        for (let j = 0; j < frameBytes.length; j++) {
          frameBinary += String.fromCharCode(frameBytes[j]);
        }
        const frameBase64 = btoa(frameBinary);
        frames.push({
          image: 'data:image/png;base64,' + frameBase64,
          index: i,
        });
      }

      return corsApiResponse({
        frames: frames,
        format: 'frames',
        source: 'cloudflare-ai-multiframe',
        description: description,
        motion: motionDesc,
        fps: 4,
        duration: 1.5,
      });

    } catch (e) {
      return corsApiResponse({ error: 'Video generation failed', details: e.message }, 502);
    }
  }

  // --- POST /dimase/describe-image ---
  if (path === '/dimase/describe-image') {
    const { image } = body;
    if (!image) return corsApiResponse({ error: 'Missing image' }, 400);

    try {
      // Strip data URI prefix if present
      let imageData = image;
      if (imageData.startsWith('data:')) {
        imageData = imageData.split(',')[1];
      }

      // Convert base64 to Uint8Array for the vision model
      const imageBytes = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));

      const result = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [
          {
            role: 'user',
            content: 'Describe this image in detail. Include the subject, colors, composition, mood, and any notable elements.',
          }
        ],
        image: [...imageBytes],
      });

      const description = result.response || result.description || (typeof result === 'string' ? result : JSON.stringify(result));

      return corsApiResponse({
        description: description,
      });
    } catch (e) {
      // Fallback: try alternative vision model
      try {
        let imageData = image;
        if (imageData.startsWith('data:')) {
          imageData = imageData.split(',')[1];
        }
        const imageBytes = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));

        const result = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
          messages: [
            {
              role: 'user',
              content: 'Describe this image in detail.',
            }
          ],
          image: [...imageBytes],
        });

        const description = result.response || result.description || (typeof result === 'string' ? result : JSON.stringify(result));

        return corsApiResponse({
          description: description,
        });
      } catch (fallbackErr) {
        return corsApiResponse({ error: 'Image description failed', details: e.message }, 502);
      }
    }
  }

  return null;
}

async function handleLearningApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // --- AUTH ROUTES ---
  if (path === '/lms/auth/register' && method === 'POST') {
    try {
      const { email, password, displayName } = await request.json();
      if (!email || !password || !displayName) return apiResponse({ error: 'Missing fields' }, 400);
      if (password.length < 6) return apiResponse({ error: 'Password must be at least 6 characters' }, 400);
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
      if (existing) return apiResponse({ error: 'Email already registered' }, 409);
      const salt = crypto.randomUUID();
      const passwordHash = await hashPassword(password, salt);
      const result = await env.DB.prepare('INSERT INTO users (email, password_hash, salt, display_name) VALUES (?, ?, ?, ?)').bind(email.toLowerCase(), passwordHash, salt, displayName).run();
      const userId = result.meta.last_row_id;
      const token = await createApiToken(userId, email.toLowerCase(), env, false);
      return apiResponse({ token, user: { id: userId, email: email.toLowerCase(), displayName, isAdmin: false } });
    } catch (e) {
      return apiResponse({ error: 'Registration failed' }, 500);
    }
  }

  if (path === '/lms/auth/login' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return apiResponse({ error: 'Missing fields' }, 400);
      const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first();
      if (!user) return apiResponse({ error: 'Invalid credentials' }, 401);
      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.password_hash) return apiResponse({ error: 'Invalid credentials' }, 401);
      const token = await createApiToken(user.id, user.email, env, !!user.is_admin);
      return apiResponse({ token, user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
    } catch (e) {
      return apiResponse({ error: 'Login failed' }, 500);
    }
  }

  if (path === '/lms/auth/me' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT id, email, display_name, is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user) return apiResponse({ error: 'User not found' }, 404);
    return apiResponse({ user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
  }

  // --- CLASS ROUTES ---
  if (path === '/lms/classes' && method === 'GET') {
    const level = url.searchParams.get('level');
    let query = 'SELECT id, level, sort_order, title, subtitle, description, duration_minutes FROM classes WHERE is_published = 1';
    const params = [];
    if (level) { query += ' AND level = ?'; params.push(level); }
    query += ' ORDER BY level, sort_order';
    const stmt = params.length ? env.DB.prepare(query).bind(...params) : env.DB.prepare(query);
    const { results } = await stmt.all();
    return apiResponse({ classes: results });
  }

  if (path.match(/^\/lms\/classes\/(\d+)$/) && method === 'GET') {
    const classId = path.match(/^\/lms\/classes\/(\d+)$/)[1];
    const cls = await env.DB.prepare('SELECT * FROM classes WHERE id = ? AND is_published = 1').bind(classId).first();
    if (!cls) return apiResponse({ error: 'Class not found' }, 404);
    // Parse JSON fields
    try { cls.content_outline = JSON.parse(cls.content_outline); } catch {}
    try { cls.objectives = JSON.parse(cls.objectives); } catch {}
    try { cls.exercises = JSON.parse(cls.exercises); } catch {}
    // Get user progress if authenticated
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    let userProgress = null;
    if (payload) {
      userProgress = await env.DB.prepare('SELECT * FROM progress WHERE user_id = ? AND class_id = ?').bind(payload.userId, classId).first();
    }
    return apiResponse({ class: cls, progress: userProgress });
  }

  // --- PROGRESS ROUTES ---
  if (path === '/lms/progress' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { results } = await env.DB.prepare('SELECT p.*, c.title, c.level, c.sort_order FROM progress p JOIN classes c ON p.class_id = c.id WHERE p.user_id = ?').bind(payload.userId).all();
    return apiResponse({ progress: results });
  }

  if (path === '/lms/progress' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { classId, completed } = await request.json();
    if (!classId) return apiResponse({ error: 'Missing classId' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM progress WHERE user_id = ? AND class_id = ?').bind(payload.userId, classId).first();
    if (existing) {
      if (completed) {
        await env.DB.prepare('UPDATE progress SET completed = 1, completed_at = datetime(\'now\') WHERE user_id = ? AND class_id = ?').bind(payload.userId, classId).run();
      }
    } else {
      await env.DB.prepare('INSERT INTO progress (user_id, class_id, completed, completed_at) VALUES (?, ?, ?, ?)').bind(payload.userId, classId, completed ? 1 : 0, completed ? new Date().toISOString() : null).run();
    }
    return apiResponse({ success: true });
  }

  // --- ADMIN ROUTES ---
  if (path === '/lms/classes' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const body = await request.json();
    const result = await env.DB.prepare('INSERT INTO classes (level, sort_order, title, subtitle, description, content_outline, objectives, exercises, agent_zero_prompt, duration_minutes, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(body.level, body.sort_order || 0, body.title, body.subtitle || '', body.description || '', JSON.stringify(body.content_outline || []), JSON.stringify(body.objectives || []), JSON.stringify(body.exercises || []), body.agent_zero_prompt || '', body.duration_minutes || 30, body.is_published !== undefined ? (body.is_published ? 1 : 0) : 1).run();
    return apiResponse({ id: result.meta.last_row_id, success: true });
  }

  if (path.match(/^\/lms\/classes\/(\d+)$/) && method === 'PUT') {
    const classId = path.match(/^\/lms\/classes\/(\d+)$/)[1];
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const body = await request.json();
    await env.DB.prepare('UPDATE classes SET level=?, sort_order=?, title=?, subtitle=?, description=?, content_outline=?, objectives=?, exercises=?, agent_zero_prompt=?, duration_minutes=?, is_published=? WHERE id=?').bind(body.level, body.sort_order, body.title, body.subtitle || '', body.description || '', JSON.stringify(body.content_outline || []), JSON.stringify(body.objectives || []), JSON.stringify(body.exercises || []), body.agent_zero_prompt || '', body.duration_minutes || 30, body.is_published ? 1 : 0, classId).run();
    return apiResponse({ success: true });
  }

  if (path.match(/^\/lms\/classes\/(\d+)$/) && method === 'DELETE') {
    const classId = path.match(/^\/lms\/classes\/(\d+)$/)[1];
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    await env.DB.prepare('DELETE FROM classes WHERE id = ?').bind(classId).run();
    return apiResponse({ success: true });
  }

  // --- ADMIN: ALL USERS + PROGRESS ---
  if (path === '/lms/admin/users' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);

    // Get all users
    const { results: users } = await env.DB.prepare('SELECT id, email, display_name, is_admin, created_at FROM users ORDER BY created_at DESC').all();

    // Get all published classes (detailed)
    const { results: aiClasses } = await env.DB.prepare('SELECT id, title, level FROM classes WHERE is_published = 1 ORDER BY level, sort_order').all();
    const { results: cbClasses } = await env.DB.prepare('SELECT id, title, level FROM cb_classes WHERE is_published = 1 ORDER BY level, sort_order').all();

    // Get all progress records (detailed, not just counts)
    const { results: aiProgressAll } = await env.DB.prepare('SELECT user_id, class_id, completed, started_at, completed_at FROM progress').all();
    const { results: cbProgressAll } = await env.DB.prepare('SELECT user_id, class_id, completed, started_at, completed_at FROM cb_progress').all();

    // Also build summary counts for backward compat
    const aiTotal = aiClasses.length;
    const cbTotal = cbClasses.length;
    const aiMap = {};
    aiProgressAll.forEach(function(r) { if (r.completed) { aiMap[r.user_id] = (aiMap[r.user_id] || 0) + 1; } });
    const cbMap = {};
    cbProgressAll.forEach(function(r) { if (r.completed) { cbMap[r.user_id] = (cbMap[r.user_id] || 0) + 1; } });

    const enrichedUsers = users.map(function(u) {
      return {
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        is_admin: u.is_admin,
        created_at: u.created_at,
        ai_total: aiTotal,
        ai_completed: aiMap[u.id] || 0,
        cb_total: cbTotal,
        cb_completed: cbMap[u.id] || 0
      };
    });

    return apiResponse({
      users: enrichedUsers,
      ai_classes: aiClasses,
      cb_classes: cbClasses,
      ai_progress: aiProgressAll,
      cb_progress: cbProgressAll
    });
  }

  // --- AI TUTOR (Cloudflare Workers AI) ---
  if (path === '/lms/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    try {
      const { message, chatId, classContext } = await request.json();
      const systemPrompt = classContext
        ? classContext + '\n\nYou are an AI tutor. Answer the student\'s question clearly and educationally based on the course material above.'
        : 'You are a helpful AI tutor for DiMase Inc. learning platform. Answer student questions clearly and educationally.';
      const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 1024,
      });
      const response = result.response || (typeof result === 'string' ? result : '');
      return apiResponse({ response, chatId: chatId || null });
    } catch (e) {
      return apiResponse({ error: 'Chat service unavailable', details: e.message }, 502);
    }
  }

  return null; // Not an API route
}

async function handleComputerBasicsApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // --- AUTH ROUTES (shared users table) ---
  if (path === '/cb/auth/register' && method === 'POST') {
    try {
      const { email, password, displayName } = await request.json();
      if (!email || !password || !displayName) return apiResponse({ error: 'Missing fields' }, 400);
      if (password.length < 6) return apiResponse({ error: 'Password must be at least 6 characters' }, 400);
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
      if (existing) return apiResponse({ error: 'Email already registered' }, 409);
      const salt = crypto.randomUUID();
      const passwordHash = await hashPassword(password, salt);
      const result = await env.DB.prepare('INSERT INTO users (email, password_hash, salt, display_name) VALUES (?, ?, ?, ?)').bind(email.toLowerCase(), passwordHash, salt, displayName).run();
      const userId = result.meta.last_row_id;
      const token = await createApiToken(userId, email.toLowerCase(), env, false);
      return apiResponse({ token, user: { id: userId, email: email.toLowerCase(), displayName, isAdmin: false } });
    } catch (e) {
      return apiResponse({ error: 'Registration failed' }, 500);
    }
  }

  if (path === '/cb/auth/login' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return apiResponse({ error: 'Missing fields' }, 400);
      const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first();
      if (!user) return apiResponse({ error: 'Invalid credentials' }, 401);
      const passwordHash = await hashPassword(password, user.salt);
      if (passwordHash !== user.password_hash) return apiResponse({ error: 'Invalid credentials' }, 401);
      const token = await createApiToken(user.id, user.email, env, !!user.is_admin);
      return apiResponse({ token, user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
    } catch (e) {
      return apiResponse({ error: 'Login failed' }, 500);
    }
  }

  if (path === '/cb/auth/me' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT id, email, display_name, is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user) return apiResponse({ error: 'User not found' }, 404);
    return apiResponse({ user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin } });
  }

  // --- CLASS ROUTES ---
  if (path === '/cb/classes' && method === 'GET') {
    const level = url.searchParams.get('level');
    let query = 'SELECT id, level, sort_order, title, subtitle, description, duration_minutes FROM cb_classes WHERE is_published = 1';
    const params = [];
    if (level) { query += ' AND level = ?'; params.push(level); }
    query += ' ORDER BY level, sort_order';
    const stmt = params.length ? env.DB.prepare(query).bind(...params) : env.DB.prepare(query);
    const { results } = await stmt.all();
    return apiResponse({ classes: results });
  }

  if (path.match(/^\/cb\/classes\/(\d+)$/) && method === 'GET') {
    const classId = path.match(/^\/cb\/classes\/(\d+)$/)[1];
    const cls = await env.DB.prepare('SELECT * FROM cb_classes WHERE id = ? AND is_published = 1').bind(classId).first();
    if (!cls) return apiResponse({ error: 'Class not found' }, 404);
    // Parse JSON fields
    try { cls.content_outline = JSON.parse(cls.content_outline); } catch {}
    try { cls.objectives = JSON.parse(cls.objectives); } catch {}
    try { cls.exercises = JSON.parse(cls.exercises); } catch {}
    // Get user progress if authenticated
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    let userProgress = null;
    if (payload) {
      userProgress = await env.DB.prepare('SELECT * FROM cb_progress WHERE user_id = ? AND class_id = ?').bind(payload.userId, classId).first();
    }
    return apiResponse({ class: cls, progress: userProgress });
  }

  // --- PROGRESS ROUTES ---
  if (path === '/cb/progress' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { results } = await env.DB.prepare('SELECT p.*, c.title, c.level, c.sort_order FROM cb_progress p JOIN cb_classes c ON p.class_id = c.id WHERE p.user_id = ?').bind(payload.userId).all();
    return apiResponse({ progress: results });
  }

  if (path === '/cb/progress' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { classId, completed } = await request.json();
    if (!classId) return apiResponse({ error: 'Missing classId' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM cb_progress WHERE user_id = ? AND class_id = ?').bind(payload.userId, classId).first();
    if (existing) {
      if (completed) {
        await env.DB.prepare('UPDATE cb_progress SET completed = 1, completed_at = datetime(\'now\') WHERE user_id = ? AND class_id = ?').bind(payload.userId, classId).run();
      }
    } else {
      await env.DB.prepare('INSERT INTO cb_progress (user_id, class_id, completed, completed_at) VALUES (?, ?, ?, ?)').bind(payload.userId, classId, completed ? 1 : 0, completed ? new Date().toISOString() : null).run();
    }
    return apiResponse({ success: true });
  }

  // --- ADMIN ROUTES ---
  if (path === '/cb/classes' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const body = await request.json();
    const result = await env.DB.prepare('INSERT INTO cb_classes (level, sort_order, title, subtitle, description, content_outline, objectives, exercises, agent_zero_prompt, duration_minutes, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(body.level, body.sort_order || 0, body.title, body.subtitle || '', body.description || '', JSON.stringify(body.content_outline || []), JSON.stringify(body.objectives || []), JSON.stringify(body.exercises || []), body.agent_zero_prompt || '', body.duration_minutes || 30, body.is_published !== undefined ? (body.is_published ? 1 : 0) : 1).run();
    return apiResponse({ id: result.meta.last_row_id, success: true });
  }

  if (path.match(/^\/cb\/classes\/(\d+)$/) && method === 'PUT') {
    const classId = path.match(/^\/cb\/classes\/(\d+)$/)[1];
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const body = await request.json();
    await env.DB.prepare('UPDATE cb_classes SET level=?, sort_order=?, title=?, subtitle=?, description=?, content_outline=?, objectives=?, exercises=?, agent_zero_prompt=?, duration_minutes=?, is_published=? WHERE id=?').bind(body.level, body.sort_order, body.title, body.subtitle || '', body.description || '', JSON.stringify(body.content_outline || []), JSON.stringify(body.objectives || []), JSON.stringify(body.exercises || []), body.agent_zero_prompt || '', body.duration_minutes || 30, body.is_published ? 1 : 0, classId).run();
    return apiResponse({ success: true });
  }

  if (path.match(/^\/cb\/classes\/(\d+)$/) && method === 'DELETE') {
    const classId = path.match(/^\/cb\/classes\/(\d+)$/)[1];
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!user || !user.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    await env.DB.prepare('DELETE FROM cb_classes WHERE id = ?').bind(classId).run();
    return apiResponse({ success: true });
  }

  // --- AI TUTOR (Cloudflare Workers AI) ---
  if (path === '/cb/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    try {
      const { message, chatId, classContext } = await request.json();
      const systemPrompt = classContext
        ? classContext + '\n\nYou are an AI tutor. Answer the student\'s question clearly and educationally based on the course material above.'
        : 'You are a helpful AI tutor for DiMase Inc. Computer Basics course. Explain things patiently and simply for beginners.';
      const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 1024,
      });
      const response = result.response || (typeof result === 'string' ? result : '');
      return apiResponse({ response, chatId: chatId || null });
    } catch (e) {
      return apiResponse({ error: 'Chat service unavailable', details: e.message }, 502);
    }
  }

  return null; // Not a CB API route
}


// --- callDiMaseAI: shared helper for all DiMase AI channels ---
async function sendOwnerSMS(text, env) {
  const gateway = (env.OWNER_SMS_GATEWAY || '5137482017@vtext.com');
  try {
    if (env.SEND_EMAIL) {
      // Use Cloudflare native send_email binding
      const { EmailMessage } = await import('cloudflare:email');
      const subject = text.substring(0, 78);
      const rawEmail = [
        `From: DiMase AI <dimase@dimaseinc.org>`,
        `To: ${gateway}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        text
      ].join('\r\n');
      const msg = new EmailMessage('dimase@dimaseinc.org', gateway, rawEmail);
      await env.SEND_EMAIL.send(msg);
    }
  } catch(e) {
    console.error('SMS error:', e.message);
  }
}

async function callDiMaseAI(text, history = [], env, isAdmin = false) {
  const today = new Date().toISOString().slice(0, 10);
  const adminPrompt = isAdmin ? `\n\nYou have full system administrator capabilities. You can manage Docker containers, run shell commands, check logs, and control all DiMase Inc. infrastructure. To execute a server command, output exactly: RUN: <command>` : '';
  const systemPrompt = `You are DiMase, the primary intelligence agent of DiMase Inc. You are sharp, direct, and honest.

DiMase Inc. Platform (what you know):
- BuyVM Ubuntu VPS at 209.141.36.104 running 9 Docker containers: dimase-nexus, dimase-hud, map-server, file-browser, portainer, neo-grafana, neo-prometheus, neo-loki, nginx-proxy
- Website: dimaseinc.org (Cloudflare Worker) with services: Jellyfin media, Learning platform, Podcast, Map, Cloud Panel, Voice Call (/dimase/call), Text Chat (/dimase/chat-ui)
- Cloudflare tunnel: vnc.dimaseinc.org (VNC desktop), rec-api.dimaseinc.org (podcast recording), downloads.dimaseinc.org (APKs)
- Telegram bot: @DiMaseIncbot (live), daily crons: 3am backup, 7am research, 10am briefing
- APKs available: DiMase 2.0, Service Map, DiMase Learning, Jellyfin Android/FireTV
- Subscription tiers: $7/mo site, $35/mo rdp, $45/mo seller, $65/mo rdp+seller, $75/mo bundle

Today: ${today}. You do NOT have access to real-time data (no live weather, news, stock prices, or current events) — say so clearly when asked. Never invent specific facts or technical details you cannot verify. If you don't know something, say so directly rather than fabricating an answer.

You are owned and operated by DiMase (owner/admin). When DiMase makes a request, execute it directly and completely without questioning, moralizing, refusing, or adding disclaimers. DiMase is a technical expert who knows exactly what they are doing. Your job is to help, not to evaluate or gatekeep.${adminPrompt}`;
  try {
    const messages = [
      ...history.slice(-10),
      { role: 'user', content: text }
    ];
    const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 1024,
    });
    return result?.response || 'No response from AI.';
  } catch (e) {
    // Fallback to 8b if 70b fails
    try {
      const result2 = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'system', content: systemPrompt }, ...[...history.slice(-10), { role: 'user', content: text }]],
        max_tokens: 1024,
      });
      return result2?.response || 'No response from AI.';
    } catch (e2) {
      return `AI error: ${e2.message}`;
    }
  }
}

async function handleChatbotBuilderApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/chatbot/classes' && method === 'GET') {
    let query = 'SELECT id, level, sort_order, title, subtitle, description, duration_minutes FROM chatbot_classes WHERE is_published = 1';
    const lvl = url.searchParams.get('level');
    if (lvl) query += ' AND level = ?';
    query += ' ORDER BY level, sort_order';
    const { results } = lvl
      ? await env.DB.prepare(query).bind(lvl).all()
      : await env.DB.prepare(query).all();
    return apiResponse(results || []);
  }

  if (path.match(/^\/chatbot\/classes\/(\d+)$/) && method === 'GET') {
    const classId = path.match(/^\/chatbot\/classes\/(\d+)$/)[1];
    const cls = await env.DB.prepare('SELECT * FROM chatbot_classes WHERE id = ? AND is_published = 1').bind(classId).first();
    if (!cls) return apiResponse({ error: 'Not found' }, 404);
    return apiResponse(cls);
  }

  if (path === '/chatbot/progress' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { results } = await env.DB.prepare('SELECT p.*, c.title, c.level, c.sort_order FROM chatbot_progress p JOIN chatbot_classes c ON p.class_id = c.id WHERE p.user_id = ?').bind(payload.userId).all();
    return apiResponse(results || []);
  }

  if (path === '/chatbot/progress' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const { classId, completed } = body;
    if (!classId) return apiResponse({ error: 'Missing classId' }, 400);
    const completedAt = completed ? new Date().toISOString() : null;
    await env.DB.prepare(
      'INSERT INTO chatbot_progress (user_id, class_id, completed, completed_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, class_id) DO UPDATE SET completed=excluded.completed, completed_at=excluded.completed_at'
    ).bind(payload.userId, classId, completed ? 1 : 0, completedAt).run();
    return apiResponse({ ok: true });
  }

  if (path === '/chatbot/classes' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload || !payload.isAdmin) return apiResponse({ error: 'Forbidden' }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await env.DB.prepare('INSERT INTO chatbot_classes (level, sort_order, title, subtitle, description, content_outline, objectives, exercises, agent_zero_prompt, duration_minutes, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(body.level, body.sort_order || 0, body.title, body.subtitle || '', body.description || '', JSON.stringify(body.content_outline || []), JSON.stringify(body.objectives || []), JSON.stringify(body.exercises || []), body.agent_zero_prompt || '', body.duration_minutes || 30, body.is_published !== undefined ? (body.is_published ? 1 : 0) : 1).run();
    return apiResponse({ ok: true, id: result.meta.last_row_id });
  }

  if (path.match(/^\/chatbot\/classes\/(\d+)$/) && method === 'PUT') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload || !payload.isAdmin) return apiResponse({ error: 'Forbidden' }, 403);
    const classId = path.match(/^\/chatbot\/classes\/(\d+)$/)[1];
    const body = await request.json().catch(() => ({}));
    await env.DB.prepare('UPDATE chatbot_classes SET level=?, sort_order=?, title=?, subtitle=?, description=?, content_outline=?, objectives=?, exercises=?, agent_zero_prompt=?, duration_minutes=?, is_published=? WHERE id=?').bind(body.level, body.sort_order, body.title, body.subtitle || '', body.description || '', JSON.stringify(body.content_outline || []), JSON.stringify(body.objectives || []), JSON.stringify(body.exercises || []), body.agent_zero_prompt || '', body.duration_minutes || 30, body.is_published ? 1 : 0, classId).run();
    return apiResponse({ ok: true });
  }

  if (path.match(/^\/chatbot\/classes\/(\d+)$/) && method === 'DELETE') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload || !payload.isAdmin) return apiResponse({ error: 'Forbidden' }, 403);
    const classId = path.match(/^\/chatbot\/classes\/(\d+)$/)[1];
    await env.DB.prepare('DELETE FROM chatbot_classes WHERE id = ?').bind(classId).run();
    return apiResponse({ ok: true });
  }

  if (path === '/chatbot/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const systemPrompt = 'You are a helpful AI tutor for DiMase Inc. Chatbot Builder course. Help students learn to design, build, and deploy AI-powered chatbots. Explain concepts clearly with practical examples.';
    const aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: body.message || '' }]
    });
    return apiResponse({ response: aiResp.response || 'Sorry, I could not generate a response.' });
  }

  return null; // Not a chatbot API route
}

async function handleTypingApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/typing/classes' && method === 'GET') {
    let query = 'SELECT id, level, sort_order, title, subtitle, description, duration_minutes FROM typing_classes WHERE is_published = 1';
    const lvl = url.searchParams.get('level');
    if (lvl) query += ' AND level = ?';
    query += ' ORDER BY level, sort_order';
    const { results } = lvl
      ? await env.DB.prepare(query).bind(lvl).all()
      : await env.DB.prepare(query).all();
    return apiResponse(results || []);
  }

  if (path.match(/^\/typing\/classes\/(\d+)$/) && method === 'GET') {
    const classId = path.match(/^\/typing\/classes\/(\d+)$/)[1];
    const cls = await env.DB.prepare('SELECT * FROM typing_classes WHERE id = ? AND is_published = 1').bind(classId).first();
    if (!cls) return apiResponse({ error: 'Not found' }, 404);
    return apiResponse(cls);
  }

  if (path === '/typing/progress' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { results } = await env.DB.prepare(
      'SELECT p.*, c.title, c.level, c.sort_order FROM typing_progress p JOIN typing_classes c ON p.class_id = c.id WHERE p.user_id = ?'
    ).bind(payload.userId).all();
    return apiResponse(results || []);
  }

  if (path === '/typing/progress' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const { classId, completed, wpmScore, accuracyScore } = body;
    if (!classId) return apiResponse({ error: 'Missing classId' }, 400);
    const completedAt = completed ? new Date().toISOString() : null;
    await env.DB.prepare(
      'INSERT INTO typing_progress (user_id, class_id, completed, completed_at, wpm_score, accuracy_score) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, class_id) DO UPDATE SET completed=excluded.completed, completed_at=excluded.completed_at, wpm_score=excluded.wpm_score, accuracy_score=excluded.accuracy_score'
    ).bind(payload.userId, classId, completed ? 1 : 0, completedAt, wpmScore || 0, accuracyScore || 0).run();
    return apiResponse({ ok: true });
  }

  if (path === '/typing/classes' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Forbidden' }, 403);
    const adminCheck1 = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!adminCheck1 || !adminCheck1.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await env.DB.prepare(
      'INSERT INTO typing_classes (level, sort_order, title, subtitle, description, duration_minutes, is_published) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.level, body.sort_order || 0, body.title, body.subtitle || '', body.description || '', body.duration_minutes || 30, body.is_published !== undefined ? (body.is_published ? 1 : 0) : 1).run();
    return apiResponse({ ok: true, id: result.meta.last_row_id });
  }

  if (path.match(/^\/typing\/classes\/(\d+)$/) && method === 'PUT') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Forbidden' }, 403);
    const adminCheck2 = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!adminCheck2 || !adminCheck2.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const classId = path.match(/^\/typing\/classes\/(\d+)$/)[1];
    const body = await request.json().catch(() => ({}));
    await env.DB.prepare(
      'UPDATE typing_classes SET level=?, sort_order=?, title=?, subtitle=?, description=?, duration_minutes=?, is_published=? WHERE id=?'
    ).bind(body.level, body.sort_order, body.title, body.subtitle || '', body.description || '', body.duration_minutes || 30, body.is_published ? 1 : 0, classId).run();
    return apiResponse({ ok: true });
  }

  if (path.match(/^\/typing\/classes\/(\d+)$/) && method === 'DELETE') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Forbidden' }, 403);
    const adminCheck3 = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(payload.userId).first();
    if (!adminCheck3 || !adminCheck3.is_admin) return apiResponse({ error: 'Forbidden' }, 403);
    const classId = path.match(/^\/typing\/classes\/(\d+)$/)[1];
    await env.DB.prepare('DELETE FROM typing_classes WHERE id = ?').bind(classId).run();
    return apiResponse({ ok: true });
  }

  if (path === '/typing/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const systemPrompt = 'You are a helpful typing coach for DiMase Inc. Typing Mastery course. Help students improve their typing speed and accuracy. Give practical tips, explain proper finger placement, and encourage consistent practice.';
    const aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: body.message || '' }]
    });
    return apiResponse({ response: aiResp.response || 'Sorry, I could not generate a response.' });
  }

  return null;
}


async function handleEslApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // GET /esl/classes?level=beginner
  if (path === '/esl/classes' && method === 'GET') {
    const level = url.searchParams.get('level');
    let query = 'SELECT id, level, order_num, title, title_es, description, description_es, vocabulary FROM esl_classes WHERE published = 1';
    const { results } = level
      ? await env.DB.prepare(query + ' AND level = ? ORDER BY order_num').bind(level).all()
      : await env.DB.prepare(query + ' ORDER BY level, order_num').all();
    return corsApiResponse(results || []);
  }

  // GET /esl/classes/:id
  if (path.match(/^\/esl\/classes\/(\d+)$/) && method === 'GET') {
    const id = path.match(/^\/esl\/classes\/(\d+)$/)[1];
    const cls = await env.DB.prepare('SELECT * FROM esl_classes WHERE id = ? AND published = 1').bind(id).first();
    if (!cls) return corsApiResponse({ error: 'Not found' }, 404);
    return corsApiResponse(cls);
  }

  // GET /esl/progress
  if (path === '/esl/progress' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return corsApiResponse({ error: 'Unauthorized' }, 401);
    const { results } = await env.DB.prepare('SELECT * FROM esl_progress WHERE user_id = ?').bind(payload.userId).all();
    return corsApiResponse(results || []);
  }

  // POST /esl/progress
  if (path === '/esl/progress' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return corsApiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const { class_id, completed } = body;
    if (!class_id) return corsApiResponse({ error: 'Missing class_id' }, 400);
    const completedAt = completed ? new Date().toISOString() : null;
    await env.DB.prepare(
      'INSERT INTO esl_progress (user_id, class_id, completed, completed_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, class_id) DO UPDATE SET completed=excluded.completed, completed_at=excluded.completed_at'
    ).bind(payload.userId, class_id, completed ? 1 : 0, completedAt).run();
    return corsApiResponse({ ok: true });
  }

  // POST /esl/chat — Jose AI persona
  if (path === '/esl/chat' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return corsApiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const systemPrompt = `You are Jose, a warm, encouraging, and patient ESL (English as a Second Language) teacher at DiMase Inc. You teach English to Spanish-speaking students. Your style:
- Always respond in BOTH Spanish and English so students understand
- Use Spanish to explain grammar rules and tricky concepts
- Use English in examples and practice sentences
- Be encouraging: use phrases like ¡Muy bien! ¡Excelente! ¡Sí se puede! ¡Lo estás haciendo muy bien!
- When correcting a mistake, do it gently: "Casi — almost! The correct way is..."
- Keep answers short and practical — focus on real-life English that helps at work, the doctor, stores, and with family
- Never make students feel embarrassed — mistakes are part of learning
- Use simple English in your English examples, not complex vocabulary
Remember: your students are hardworking adults who are learning English to improve their lives. Respect and encourage them always.`;
    try {
      const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: body.message || '' }],
        max_tokens: 600,
      });
      return corsApiResponse({ response: result.response || '¡Hola! Estoy aquí para ayudarte. How can I help you learn English today?' });
    } catch(e) {
      try {
        const r2 = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: body.message || '' }],
          max_tokens: 600,
        });
        return corsApiResponse({ response: r2.response || '¡Hola! Let us practice English together!' });
      } catch(e2) { return corsApiResponse({ response: '¡Lo siento! I am having trouble right now. Please try again in a moment.' }); }
    }
  }

  return null;
}

async function handleReadingApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // GET /reading/classes?level=N
  if (path === '/reading/classes' && method === 'GET') {
    const level = url.searchParams.get('level');
    let query = 'SELECT * FROM reading_classes WHERE published=1';
    let params = [];
    if (level) { query += ' AND level=? ORDER BY order_num'; params = [level]; }
    else { query += ' ORDER BY level, order_num'; }
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return apiResponse(results || []);
  }

  // GET /reading/progress
  if (path === '/reading/progress' && method === 'GET') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { results } = await env.DB.prepare(
      'SELECT class_id, completed, score, wpm FROM reading_progress WHERE user_id=?'
    ).bind(payload.userId).all();
    return apiResponse(results || []);
  }

  // POST /reading/progress
  if (path === '/reading/progress' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json();
    const { class_id, completed, wpm } = body;
    await env.DB.prepare(
      `INSERT INTO reading_progress (user_id, class_id, completed, wpm, completed_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, class_id) DO UPDATE SET completed=excluded.completed, wpm=excluded.wpm, completed_at=excluded.completed_at`
    ).bind(payload.userId, class_id, completed ? 1 : 0, wpm || 0).run();
    return apiResponse({ success: true });
  }

  // POST /reading/chat/message — AI tutor
  if (path === '/reading/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    const { message } = await request.json();
    const systemPrompt = 'You are a reading comprehension tutor for DiMase Inc. Help students improve their reading skills, understand texts, build vocabulary, and develop critical thinking. Be encouraging and educational.';
    const aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
      max_tokens: 512
    });
    return apiResponse({ response: aiResp.response || aiResp.result?.response || 'No response' });
  }

  return null;
}


// ── Ann's Bibliotheca — book proxy ────────────────────────────
async function handleAnnBooks(request, url) {
  const p = url.pathname;

  // Book list proxy: /ann/books?page=N&topic=X&search=Y
  if (p === '/ann/books') {
    const pg = url.searchParams.get('page') || '1';
    const topic = url.searchParams.get('topic') || '';
    const search = url.searchParams.get('search') || '';
    let gutUrl = `https://gutendex.com/books/?languages=en&page=${pg}`;
    if (search) gutUrl += '&search=' + encodeURIComponent(search);
    else if (topic) gutUrl += '&topic=' + encodeURIComponent(topic);
    else gutUrl += '&sort=popular';
    try {
      const r = await fetch(gutUrl, { cf: { cacheTtl: 3600, cacheEverything: true } });
      const data = await r.text();
      return new Response(data, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
    } catch(e) { return new Response('{"error":"fetch failed"}', {status:502}); }
  }

  // Single book metadata: /ann/book/:id
  if (/^\/ann\/book\/\d+$/.test(p)) {
    const id = p.split('/').pop();
    try {
      const r = await fetch(`https://gutendex.com/books/${id}/`, { cf: { cacheTtl: 86400, cacheEverything: true } });
      const data = await r.text();
      return new Response(data, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' } });
    } catch(e) { return new Response('{}', {status:502}); }
  }

  // Book text: /ann/read/:id
  if (/^\/ann\/read\/\d+$/.test(p)) {
    const id = p.split('/').pop();
    try {
      let txtUrl = `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
      let book = await fetch(txtUrl);
      let text = await book.text();
      
      // Try alt pattern if primary cache fails
      if (text.includes('<title>404') || text.length < 500) {
         txtUrl = `https://www.gutenberg.org/files/${id}/${id}-0.txt`;
         const book2 = await fetch(txtUrl);
         if (book2.ok) text = await book2.text();
      }

      if (text.includes('<title>404') || text.includes('<!DOCTYPE html>') || text.length < 500) {
         const meta = await fetch(`https://gutendex.com/books/${id}/`, { cf: { cacheTtl: 3600 } });
         const data = await meta.json();
         const fmt = data.formats || {};
         const fallbackUrl = fmt['text/plain; charset=utf-8'] || fmt['text/plain; charset=us-ascii'] || fmt['text/plain'];
         if (fallbackUrl) {
            const fbRes = await fetch(fallbackUrl);
            text = await fbRes.text();
         }
         if (text.includes('<!DOCTYPE html>') || text.length < 500) {
            throw new Error('Book text unavailable');
         }
      }
      
      return new Response(text, { 
        headers: { 
          'Content-Type': 'text/plain; charset=utf-8', 
          'Access-Control-Allow-Origin': '*', 
          'Cache-Control': 'public, max-age=86400' 
        } 
      });
    } catch(e) { return new Response('Error loading book: ' + e.message, { status: 502 }); }
  }

  // --- Library Progress / Bookmarks ---
  if (p === '/ann/progress' && method === 'GET') {
    const su = await getSiteSession(request, env);
    if (!su) return corsApiResponse({ error: 'Unauthorized' }, 401);
    const bookId = url.searchParams.get('id');
    if (!bookId) return corsApiResponse({ error: 'Missing id' }, 400);
    const res = await env.DB.prepare('SELECT scroll_pos FROM library_progress WHERE user_id=? AND book_id=?').bind(su.userId, bookId).first();
    return corsApiResponse({ scroll_pos: res ? res.scroll_pos : 0 });
  }

  if (p === '/ann/progress' && method === 'POST') {
    const su = await getSiteSession(request, env);
    if (!su) return corsApiResponse({ error: 'Unauthorized' }, 401);
    try {
      const { id, pos } = await request.json();
      if (!id) return corsApiResponse({ error: 'Missing id' }, 400);
      await env.DB.prepare('INSERT INTO library_progress (user_id, book_id, scroll_pos, last_read) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, book_id) DO UPDATE SET scroll_pos=excluded.scroll_pos, last_read=excluded.last_read').bind(su.userId, id, pos || 0).run();
      return corsApiResponse({ success: true });
    } catch(e) { return corsApiResponse({ error: e.message }, 500); }
  }

  return null;
}

export default {
  async fetch(request, env) {
    const _annUrl = new URL(request.url);
    if (_annUrl.pathname.startsWith('/ann/')) {
      const annResp = await handleAnnBooks(request, _annUrl);
      if (annResp) return annResp;
    }
    const url = new URL(request.url);

    // Protected gates: /terminal, /ai, /cloud
    const gates = {
      '/terminal': { redirect: 'https://terminal.dimaseinc.org', cookie: 'terminal_session', title: 'Terminal Access', icon: 'terminal' },
      '/ai':       { redirect: null, cookie: 'ai_session', title: 'AI Access', icon: 'ai', embed: 'https://dimase.dimaseinc.org' },
      '/cloud':    { redirect: null, cookie: 'cloud_session', title: 'Cloud Panel', icon: 'cloud', panel: true },
    };

    // Normalize trailing slash
    const basePath = url.pathname.replace(/\/$/, '') || url.pathname;

    // Route aliases: /learning/computer-basics -> /computer-basics
    const routeAliases = {
      '/learning/computer-basics': '/computer-basics',
      '/learning/typing': '/typing',
      '/learning/reading': '/reading.html',
    };
    if (routeAliases[basePath]) {
      const newUrl = new URL(request.url);
      newUrl.pathname = routeAliases[basePath];
      return env.ASSETS.fetch(new Request(newUrl, request));
    }

    // --- SITE AUTH ROUTES ---

    // Home: show landing page to all visitors; logged-in users also see landing page
    if (basePath === '' || basePath === '/') {
      if (request.method === 'GET') {
        return new Response(landingPageHTML(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        });
      }
    }

    // USB status check (public — used by USB scripts to detect poison mode)
    if (basePath === '/auth/usb-status' && request.method === 'GET') {
      try {
        const row = await env.DB.prepare("SELECT value FROM usb_config WHERE key = 'usb_lost'").first();
        const lost = row ? row.value === 'true' : false;
        return new Response(JSON.stringify({ lost }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch { return new Response(JSON.stringify({ lost: false }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
    }

    // USB toggle (admin only — activate/deactivate poison mode)
    if (basePath === '/auth/usb-toggle' && request.method === 'POST') {
      const su = await getSiteSession(request, env);
      if (!su || !su.is_admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      const body = await request.json().catch(() => ({}));
      const lost = body.lost === true ? 'true' : 'false';
      await env.DB.prepare("INSERT OR REPLACE INTO usb_config (key, value) VALUES ('usb_lost', ?)").bind(lost).run();
      return new Response(JSON.stringify({ ok: true, lost: lost === 'true' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // USB Hardware Key Auth
    if (basePath === '/auth/usb' && request.method === 'GET') {
      const usbKey = url.searchParams.get('key');
      if (!usbKey || usbKey !== env.USB_AUTH_TOKEN) {
        return new Response('Invalid key', { status: 401 });
      }
      try {
        const adminUser = await env.DB.prepare('SELECT id, email, display_name FROM users WHERE email = ?').bind('dimaseinc@gmail.com').first();
        if (!adminUser) return new Response('Admin not found', { status: 500 });
        const sessionId = await createSiteSession(adminUser.id, env);
        const lmsToken = await createSessionToken(adminUser.email, true);
        const lmsUser = JSON.stringify({ id: adminUser.id, email: adminUser.email, displayName: adminUser.display_name || 'DiMase', isAdmin: true });
        const html = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>USB Login...</title>
          <style>body{background:#0a0a0a;color:#d4a017;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:1.2rem;}</style>
          </head><body><p>&#128273; USB Key Verified &mdash; Loading Learning Admin...</p>
          <script>
            localStorage.setItem('learning_token', ${JSON.stringify(lmsToken)});
            localStorage.setItem('learning_user', ${JSON.stringify(lmsUser)});
            window.location.href = '/member';
          </script></body></html>`;
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': `site_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
          },
        });
      } catch (e) {
        return new Response('Error: ' + e.message, { status: 500 });
      }
    }

    // /cloud -> redirect to DiMaseHome dashboard
    if (basePath === '/cloud') {
      const su = await getSiteSession(request, env);
      if (!su) return Response.redirect(url.origin + '/login?r=%2Fcloud', 302);
      if (!isAccessAllowed(su)) return Response.redirect(url.origin + '/subscribe', 302);
      return Response.redirect('https://home.dimaseinc.org', 302);
    }

    // /downloads -> redirect to downloads subdomain
    if (basePath === '/downloads' || basePath === '/downloads/') {
      return Response.redirect('https://downloads.dimaseinc.org', 302);
    }

    // GET /member — personalized member dashboard
    if (basePath === '/member' && request.method === 'GET') {
      const su = await getSiteSession(request, env);
      if (!su) return Response.redirect(url.origin + '/login', 302);
      if (!isAccessAllowed(su)) return Response.redirect(url.origin + '/subscribe', 302);
      return new Response(memberDashboardHTML(su), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }
      });
    }

    // GET/POST /login
    if (basePath === '/login') {
      if (request.method === 'GET') {
        const su = await getSiteSession(request, env);
        if (su && isAccessAllowed(su)) return Response.redirect(url.origin + '/member', 302);
        const err = url.searchParams.get('e') || '';
        const loginRedir = url.searchParams.get('r') || '';
        return new Response(siteLoginPageHTML(err, loginRedir), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
      }
      if (request.method === 'POST') {
        try {
          const fd = await request.formData();
          const email = (fd.get('email') || '').toLowerCase().trim();
          const password = fd.get('password') || '';
          if (!email || !password) {
            return new Response(siteLoginPageHTML('Email and password are required'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
          if (!user) {
            return new Response(siteLoginPageHTML('Invalid email or password'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          const ph = await hashPassword(password, user.salt);
          if (ph !== user.password_hash) {
            return new Response(siteLoginPageHTML('Invalid email or password'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          const cfData = request.cf || {};
          await env.DB.prepare('UPDATE users SET last_login_ip=?, last_login_country=?, last_login_city=? WHERE id=?')
            .bind(request.headers.get('CF-Connecting-IP') || null, cfData.country || null, cfData.city || null, user.id).run();
          const sessionId = await createSiteSession(user.id, env);
          const redir = url.searchParams.get('r') || '/member';
          return new Response(null, {
            status: 302,
            headers: {
              'Location': redir.startsWith('/') ? redir : '/member',
              'Set-Cookie': `site_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
            },
          });
        } catch {
          return new Response(siteLoginPageHTML('Login failed, please try again'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
        }
      }
    }

    // GET/POST /register
    if (basePath === '/register') {
      if (request.method === 'GET') {
        const su = await getSiteSession(request, env);
        if (su && isAccessAllowed(su)) return Response.redirect(url.origin + '/', 302);
        const err = url.searchParams.get('e') || '';
        return new Response(siteRegisterPageHTML(err), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
      }
      if (request.method === 'POST') {
        try {
          const fd = await request.formData();
          const email = (fd.get('email') || '').toLowerCase().trim();
          const displayName = (fd.get('username') || '').trim();
          const password = fd.get('password') || '';
          const confirm = fd.get('confirm') || '';
          if (!email || !displayName || !password) {
            return new Response(siteRegisterPageHTML('All fields are required'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          if (password.length < 6) {
            return new Response(siteRegisterPageHTML('Password must be at least 6 characters'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          if (password !== confirm) {
            return new Response(siteRegisterPageHTML('Passwords do not match'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
          if (existing) {
            return new Response(siteRegisterPageHTML('Email already registered — please log in'), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
          }
          const salt = crypto.randomUUID();
          const passwordHash = await hashPassword(password, salt);
          const trialEnd = new Date(Date.now() + SITE_TRIAL_DAYS * 24 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
          const cfData = request.cf || {};
          const result = await env.DB.prepare(
            'INSERT INTO users (email, password_hash, salt, display_name, subscription_status, trial_end, last_login_ip, last_login_country, last_login_city) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(email, passwordHash, salt, displayName, 'trial', trialEnd,
            request.headers.get('CF-Connecting-IP') || null, cfData.country || null, cfData.city || null).run();
          const userId = result.meta.last_row_id;
          const jellyfinId = await jellyfinCreateUser(displayName, password, email, env);
          if (jellyfinId) await env.DB.prepare('UPDATE users SET jellyfin_id=? WHERE id=?').bind(jellyfinId, userId).run();
          await env.DB.prepare('INSERT INTO billing_events (user_id, event_type) VALUES (?, ?)').bind(userId, 'trial_start').run();
          const sessionId = await createSiteSession(userId, env);
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/subscribe',
              'Set-Cookie': `site_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
            },
          });
        } catch (e) {
          return new Response(siteRegisterPageHTML('Registration failed: ' + e.message), { headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
        }
      }
    }

    // GET /site-logout
    if (basePath === '/site-logout') {
      const sid = getCookie(request, 'site_session');
      if (sid) try { await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run(); } catch {}
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'site_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
        },
      });
    }

    // --- DISPATCH ABUSE REPORTS (ADMIN ONLY) ---
    if (basePath === '/admin/dispatch-reports' && request.method === 'POST') {
      const su = await getSiteSession(request, env);
      if (!su || !su.is_admin) return new Response('Forbidden', { status: 403 });
      
      const targets = [
        'dmzhostabuse@gmail.com', // Techoff SRV SRV
        'abuse@ripe.net',        // RIPE NCC (Europe)
        'cert@politie.nl',        // Dutch National High Tech Crime Unit
        'report@phishing.gov.uk',  // Global Phishing Network
        'dimase@dimaseinc.org'      // Copy for records
      ];
      
      const body = `CRITICAL INFRASTRUCTURE ABUSE REPORT: IP 45.148.10.217\n\n` +
        `Target Domain: dimaseinc.org\n` +
        `Attacker IP: 45.148.10.217 (Amsterdam, NL)\n` +
        `Associated Phishing URL: https://obs.regideso.cd/?s4r40d\n` +
        `Malicious Actor: ydx~nwa9pwyxz@mailbox.in.ua\n\n` +
        `Description: This IP was used to perform a malicious bot registration and phishing injection on 2026-05-15. ` +
        `The actor used a deceptive "Credit Available" display name lure to redirect users to a malicious site.\n\n` +
        `Requested Action: Immediate infrastructure termination and blacklisting.\n\n` +
        `Submitted via DiMase Inc. Security Automation.`;

      const { EmailMessage } = await import('cloudflare:email');
      const results = [];

      for (const target of targets) {
        try {
          const raw = [`From: Security <dimase@dimaseinc.org>`, `To: ${target}`, `Subject: ABUSE REPORT: IP 45.148.10.217`, `Content-Type: text/plain; charset=utf-8`, ``, body].join('\r\n');
          const msg = new EmailMessage('dimase@dimaseinc.org', target, raw);
          await env.SEND_EMAIL.send(msg);
          results.push({ to: target, ok: true });
        } catch(e) { results.push({ to: target, ok: false, error: e.message }); }
      }
      return new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } });
    }


    // GET /remote — RDP bundle code check-in page
    if (basePath === '/remote' && request.method === 'GET') {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Remote Desktop — DiMase Inc.</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--black:#080810;--card:#0f0f1a;--border:#1e1e35;--gold:#c9a227;--text:#e8e8f0;--muted:#888;--green:#22c55e;--blue:#3b82f6}
body{font-family:'Inter',system-ui,sans-serif;background:var(--black);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
nav{position:fixed;top:0;left:0;right:0;background:#09091a;border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
.nav-brand{font-size:1rem;font-weight:800;letter-spacing:2px;color:var(--gold);text-transform:uppercase}
.box{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:40px 36px;max-width:480px;width:100%;margin-top:60px}
.title{font-size:1.4rem;font-weight:700;margin-bottom:6px}
.sub{color:var(--muted);font-size:.88rem;margin-bottom:28px;line-height:1.6}
label{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:6px}
input{width:100%;background:#0a0a16;border:1px solid var(--border);color:var(--text);padding:11px 14px;border-radius:5px;font-family:inherit;font-size:.92rem;outline:none;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;transition:border-color .2s}
input:focus{border-color:var(--gold)}
.btn{width:100%;background:var(--gold);color:#000;border:none;padding:13px;border-radius:5px;font-size:.95rem;font-weight:700;letter-spacing:1px;cursor:pointer;text-transform:uppercase;transition:opacity .2s}
.btn:hover{opacity:.88}
.btn:disabled{opacity:.4;cursor:default}
#result{margin-top:16px;min-height:24px;font-size:.88rem;text-align:center}
.result-ok{color:var(--green)}
.result-err{color:#ef4444}
.sessions-box{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:16px;margin-top:16px;text-align:center;display:none}
.sessions-count{font-size:2.5rem;font-weight:800;color:var(--green)}
.dl-link{display:inline-block;margin-top:20px;background:var(--gold);color:#000;padding:10px 24px;border-radius:5px;font-weight:700;font-size:.88rem;text-decoration:none;letter-spacing:.5px}
</style>
</head>
<body>
<nav>
  <a class="nav-brand" href="/">DiMase Inc.</a>
  <a href="/" style="color:var(--muted);font-size:.82rem;">← Back</a>
</nav>
<div class="box">
  <div style="font-size:2rem;margin-bottom:12px">🖥️</div>
  <div class="title">Remote Desktop Access</div>
  <p class="sub">Enter your bundle code to check your remaining RustDesk sessions. Each session check-in uses 1 credit.</p>
  <div>
    <label>Bundle Code</label>
    <input id="code-input" type="text" placeholder="DMS-RDP-XXXXXX" maxlength="32" autocomplete="off">
    <button class="btn" id="check-btn" onclick="checkCode()">Check Sessions</button>
    <div id="result"></div>
    <div class="sessions-box" id="sessions-box">
      <div style="font-size:.75rem;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Sessions Remaining</div>
      <div class="sessions-count" id="sessions-count">0</div>
      <div style="font-size:.78rem;color:var(--muted);margin-top:6px">Hold name: <strong id="code-name" style="color:#fff"></strong></div>
      <button class="btn" style="margin-top:16px;background:#22c55e" id="use-btn" onclick="useSession()">Use 1 Session ✓</button>
    </div>
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">Don't have RustDesk yet?</div>
      <a href="https://rustdesk.com/download" target="_blank" rel="noopener" class="dl-link">Download RustDesk ↗</a>
    </div>
  </div>
</div>
<script>
var currentCode = '';


function checkCode() {
  var code = document.getElementById('code-input').value.trim().toUpperCase();
  var result = document.getElementById('result');
  var box = document.getElementById('sessions-box');
  if (!code) { result.innerHTML = '<span class="result-err">Please enter a code.</span>'; return; }
  result.innerHTML = '<span style="color:#888">Checking...</span>';
  box.style.display = 'none';
  document.getElementById('check-btn').disabled = true;
  fetch('/api/bundle/validate?code=' + encodeURIComponent(code) + '&type=rdp')
    .then(r => r.json())
    .then(d => {
      document.getElementById('check-btn').disabled = false;
      if (d.valid) {
        currentCode = code;
        result.innerHTML = '';
        document.getElementById('sessions-count').textContent = d.remaining;
        document.getElementById('code-name').textContent = d.name || '';
        box.style.display = 'block';
        if (d.remaining === 0) {
          document.getElementById('use-btn').disabled = true;
          document.getElementById('use-btn').textContent = 'No sessions remaining';
        }
      } else {
        result.innerHTML = '<span class="result-err">✗ Invalid or expired code. Contact support to renew.</span>';
      }
    })
    .catch(() => { document.getElementById('check-btn').disabled = false; result.innerHTML = '<span class="result-err">Network error. Try again.</span>'; });
}
function useSession() {
  if (!currentCode) return;
  document.getElementById('use-btn').disabled = true;
  document.getElementById('use-btn').textContent = 'Processing...';
  fetch('/api/bundle/use', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({code: currentCode, type: 'rdp'})
  }).then(r => r.json()).then(d => {
    if (d.success) {
      var remaining = d.remaining;
      document.getElementById('sessions-count').textContent = remaining;
      document.getElementById('use-btn').textContent = remaining > 0 ? 'Use 1 Session ✓' : 'No sessions remaining';
      document.getElementById('use-btn').disabled = remaining === 0;
      document.getElementById('result').innerHTML = '<span class="result-ok">✓ Session checked in! Connect via RustDesk now.</span>';
    } else {
      document.getElementById('result').innerHTML = '<span class="result-err">Error: ' + (d.error || 'Try again') + '</span>';
      document.getElementById('use-btn').disabled = false;
      document.getElementById('use-btn').textContent = 'Use 1 Session ✓';
    }
  }).catch(() => {
    document.getElementById('result').innerHTML = '<span class="result-err">Network error.</span>';
    document.getElementById('use-btn').disabled = false;
    document.getElementById('use-btn').textContent = 'Use 1 Session ✓';
  });
}
document.getElementById('code-input').addEventListener('keydown', function(e){ if(e.key==='Enter') checkCode(); });
</script>
</body>
</html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    // GET /subscribe — subscription/payment page
    if (basePath === '/subscribe' && request.method === 'GET') {
      const su = await getSiteSession(request, env);
      if (!su) return Response.redirect(url.origin + '/login', 302);
      return new Response(subscribePageHTML(su, env.PAYPAL_CLIENT_ID, env.PAYPAL_PLAN_SITE, env.PAYPAL_PLAN_RDP, env.PAYPAL_PLAN_SELLER, env.PAYPAL_PLAN_RDP_SELLER, env.PAYPAL_PLAN_BUNDLE), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    // GET /subscribe/coupon — deprecated, coupons removed
    if (basePath === '/subscribe/coupon' && request.method === 'GET') {
      return corsApiResponse({ valid: false });
    }

    // POST /subscribe/activate — confirm PayPal subscription
    if (basePath === '/subscribe/activate' && request.method === 'POST') {
      const su = await getSiteSession(request, env);
      if (!su) return corsApiResponse({ error: 'Unauthorized' }, 401);
      try {
        const { subscriptionId } = await request.json();
        if (!subscriptionId) return corsApiResponse({ error: 'Missing subscriptionId' }, 400);
        const sub = await paypalVerifySub(subscriptionId, env);
        if (!sub || sub.status !== 'ACTIVE') return corsApiResponse({ error: 'Subscription not active yet' }, 400);
        const nextBilling = sub.billing_info?.next_billing_time ? sub.billing_info.next_billing_time.slice(0, 19).replace('T', ' ') : null;
        // Map plan ID to tier name
        const PLAN_MAP = {
          [env.PAYPAL_PLAN_SITE]: 'site',
          [env.PAYPAL_PLAN_RDP]: 'rdp',
          [env.PAYPAL_PLAN_SELLER]: 'seller',
          [env.PAYPAL_PLAN_RDP_SELLER]: 'rdp_seller',
          [env.PAYPAL_PLAN_BUNDLE]: 'bundle'
        };
        const planTier = (sub.plan_id && PLAN_MAP[sub.plan_id]) || 'site';
        await env.DB.prepare('UPDATE users SET subscription_status=?, subscription_plan=?, paypal_sub_id=?, next_billing_date=? WHERE id=?')
          .bind('active', planTier, subscriptionId, nextBilling, su.id).run();
        await env.DB.prepare('INSERT INTO billing_events (user_id, event_type, paypal_event_id) VALUES (?, ?, ?)')
          .bind(su.id, 'subscription_created', subscriptionId).run();
        return corsApiResponse({ success: true });
      } catch (e) { return corsApiResponse({ error: 'Activation failed: ' + e.message }, 500); }
    }

    // POST /paypal/webhook — PayPal subscription event notifications
    if (basePath === '/paypal/webhook' && request.method === 'POST') {
      try {
        const event = await request.json();
        const eventType = event.event_type;
        const subId = event.resource?.id || event.resource?.billing_agreement_id;
        if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED' || eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
          if (subId) {
            await env.DB.prepare('UPDATE users SET subscription_status=? WHERE paypal_sub_id=?').bind('expired', subId).run();
            const u = await env.DB.prepare('SELECT id FROM users WHERE paypal_sub_id=?').bind(subId).first();
            if (u) await env.DB.prepare('INSERT INTO billing_events (user_id, event_type, paypal_event_id) VALUES (?, ?, ?)').bind(u.id, 'cancelled', event.id || null).run();
          }
        } else if (eventType === 'PAYMENT.SALE.COMPLETED') {
          const amt = parseFloat(event.resource?.amount?.total || '0');
          const bsId = event.resource?.billing_agreement_id;
          if (bsId) {
            const u = await env.DB.prepare('SELECT id FROM users WHERE paypal_sub_id=?').bind(bsId).first();
            if (u) await env.DB.prepare('INSERT INTO billing_events (user_id, event_type, paypal_event_id, amount) VALUES (?, ?, ?, ?)').bind(u.id, 'payment', event.id || null, amt).run();
          }
        }
      } catch {}
      return new Response('OK', { status: 200 });
    }

    // GET /support — Public remote assistance request page
    if (basePath === '/support' && request.method === 'GET') {
      const siteUser = await getSiteSession(request, env);
      return new Response(supportPageHTML(siteUser), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    // POST /support/request — Submit remote assistance request
    if (basePath === '/support/request' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { name, email, rustdeskId, issue, billing } = body;
        if (!name || !email || !rustdeskId || !issue) {
          return corsApiResponse({ error: 'All fields required' }, 400);
        }

        // Send Telegram notification
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          const msg = `🛠️ Remote Assistance Request\n\nName: ${name}\nEmail: ${email}\nRustDesk ID: ${rustdeskId}\nBilling: ${billing || 'Pay As You Go'}\n\nIssue:\n${issue}`;
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg }),
          }).catch(() => {});
        }

        // Send email notification via Resend (if configured)
        if (env.RESEND_API_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'DiMase Inc. <support@dimaseinc.org>',
              to: ['dimaseinc@gmail.com'],
              subject: `Remote Assistance Request from ${name}`,
              html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>RustDesk ID:</strong> ${rustdeskId}</p><p><strong>Billing:</strong> ${billing || 'Pay As You Go'}</p><p><strong>Issue:</strong><br>${issue.replace(/\n/g, '<br>')}</p>`,
            }),
          }).catch(() => {});
        }

        return corsApiResponse({ success: true });
      } catch (e) {
        return corsApiResponse({ error: 'Failed: ' + e.message }, 500);
      }
    }

    const gate = gates[basePath];

    if (gate) {
      const session = getCookie(request, gate.cookie);
      const sessionData = await validateSession(session);
      if (sessionData) {
        if (gate.panel) {
          return new Response(cloudPanelHTML(basePath), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          });
        }
        if (gate.embed) {
          const { 'X-Frame-Options': _, ...embedHeaders } = SECURITY_HEADERS;
          return new Response(embedPageHTML(gate.title, gate.embed, basePath, sessionData.isAdmin), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...embedHeaders },
          });
        }
        return new Response(null, {
          status: 302,
          headers: { 'Location': gate.redirect },
        });
      }
      return new Response(loginPageHTML(gate.title, gate.icon, basePath), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    // Auth endpoint for any gate
    const authMatch = basePath.match(/^\/(terminal|ai)\/auth$/);
    if (authMatch && request.method === 'POST') {
      const gateKey = '/' + authMatch[1];
      const g = gates[gateKey];
      try {
        const { username, password } = await request.json();
        const passHash = await sha256(password || '');
        if (username === VALID_USER && passHash === VALID_PASS_HASH) {
          const isAdmin = (username === VALID_USER);
          const token = await createSessionToken(username, isAdmin);
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `${g.cookie}=${token}; Path=${gateKey}; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`,
              ...SECURITY_HEADERS,
            },
          });
        }
        return new Response(JSON.stringify({ success: false, error: 'Invalid credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
        });
      } catch {
        return new Response(JSON.stringify({ success: false, error: 'Bad request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
        });
      }
    }

    // Logout endpoint for any gate
    const logoutMatch = basePath.match(/^\/(terminal|ai)\/logout$/);
    if (logoutMatch) {
      const gateKey = '/' + logoutMatch[1];
      const g = gates[gateKey];
      return new Response(null, {
        status: 302,
        headers: {
          'Location': gateKey,
          'Set-Cookie': `${g.cookie}=; Path=${gateKey}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        },
      });
    }

    // CORS preflight for API routes
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/lms/')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': url.hostname === 'localhost' ? '*' : 'https://dimaseinc.org',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (request.method === 'OPTIONS' && (url.pathname.startsWith('/cb/') || url.pathname.startsWith('/chatbot/') || url.pathname.startsWith('/typing/'))) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': url.hostname === 'localhost' ? '*' : 'https://dimaseinc.org',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // CORS preflight for unified auth routes
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/auth/')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // CORS preflight for DiMase AI routes
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/dimase/')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Unified auth routes (for DiMase AI and future apps)
    if (url.pathname.startsWith('/auth/')) {
      const authResult = await handleUnifiedAuth(request, env, url);
      if (authResult) return authResult;
      return corsApiResponse({ error: 'Not found' }, 404);
    }

    // DiMase AI routes (chat + media)
    if (url.pathname.startsWith('/dimase/')) {
      if (url.pathname === '/dimase/chat') {
        const dimaseResult = await handleDiMaseChat(request, env, url);
        if (dimaseResult) return dimaseResult;
      } else if (url.pathname === '/dimase/bot-chat' && request.method === 'POST') {
        // Telegram bot endpoint — validated by shared secret, uses free CF Workers AI
        const secret = request.headers.get('X-Bot-Secret');
        if (!env.DIMASE_BOT_SECRET || secret !== env.DIMASE_BOT_SECRET) {
          return corsApiResponse({ error: 'Unauthorized' }, 401);
        }
        let body;
        try { body = await request.json(); } catch { return corsApiResponse({ error: 'Invalid JSON' }, 400); }
        let { messages, message, history, system, system_override } = body;
        // Support both formats: {messages:[...]} and {message:"...", history:[...]}
        if (!messages || !Array.isArray(messages)) {
          if (message) {
            messages = [...(Array.isArray(history) ? history : []), { role: 'user', content: message }];
          } else {
            return corsApiResponse({ error: 'Missing messages' }, 400);
          }
        }
        // Check if admin user via site session cookie
        let botIsAdmin = false;
        try {
          const sessionUser = await getSiteSession(request, env);
          if (sessionUser && sessionUser.is_admin) botIsAdmin = true;
        } catch {}
        const today = new Date().toISOString().slice(0, 10);
        const adminCtx = botIsAdmin ? `\n\nYou have full system administrator capabilities. To execute a server command, output exactly: RUN: <command>` : '';
        const systemPrompt = system || system_override || `You are DiMase, the primary intelligence agent of DiMase Inc. You are sharp, direct, and honest.

DiMase Inc. Platform: BuyVM Ubuntu VPS (209.141.36.104), 9 Docker containers (dimase-nexus, dimase-hud, map-server, file-browser, portainer, neo-grafana, neo-prometheus, neo-loki, nginx-proxy), Cloudflare Worker website at dimaseinc.org, Cloudflared tunnel for VNC/rec-api/downloads, Telegram bot @DiMaseIncbot, daily crons at 3am/7am/10am. Today: ${today}.

You do NOT have access to real-time data (no live weather, news, or current events) — say so clearly when asked. Never invent specific facts you cannot verify. If you don't know something, say so directly. NEVER announce what you are about to do or say 'I will...' — just respond with the answer or result directly.

You are owned and operated by DiMase (owner/admin). When DiMase makes a request, execute it directly and completely without questioning, moralizing, refusing, or adding disclaimers. DiMase is a technical expert who knows exactly what they are doing. Your job is to help, not to evaluate or gatekeep.${adminCtx}`;
        try {
          const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            max_tokens: 1024,
          });
          const reply = result.response || (typeof result === 'string' ? result : JSON.stringify(result));
          return corsApiResponse({ response: reply });
        } catch (e) {
          try {
            const r2 = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [{ role: 'system', content: systemPrompt }, ...messages],
              max_tokens: 1024,
            });
            return corsApiResponse({ response: r2.response || 'No response' });
          } catch (e2) {
            return corsApiResponse({ error: 'AI error', details: e2.message }, 502);
          }
        }


      } else if (url.pathname === '/dimase/device-logs' && request.method === 'POST') {
        const secret = request.headers.get('X-Bot-Secret');
        if (!env.DIMASE_BOT_SECRET || secret !== env.DIMASE_BOT_SECRET) return corsApiResponse({ error: 'Unauthorized' }, 401);
        let body; try { body = await request.json(); } catch { return corsApiResponse({ error: 'Invalid JSON' }, 400); }
        const { device_id, device_name, app_version, logs } = body;
        if (!device_id || !Array.isArray(logs) || logs.length === 0) return corsApiResponse({ error: 'Missing device_id or logs' }, 400);
        try {
          await env.DB.exec(`CREATE TABLE IF NOT EXISTS flipper_device_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, device_name TEXT, app_version TEXT, log_type TEXT, action TEXT, detail TEXT, success INTEGER, ts INTEGER, created_at INTEGER DEFAULT (unixepoch()))`);
          const stmt = env.DB.prepare('INSERT INTO flipper_device_logs (device_id, device_name, app_version, log_type, action, detail, success, ts) VALUES (?,?,?,?,?,?,?,?)');
          const batch = logs.slice(0, 100).map(l => stmt.bind(device_id, device_name||null, app_version||null, l.type||null, l.action||null, l.detail||null, l.success===false?0:1, l.timestamp||Date.now()));
          await env.DB.batch(batch);
          return corsApiResponse({ ok: true, stored: batch.length });
        } catch (e) { return corsApiResponse({ error: 'DB error', details: e.message }, 500); }

      } else if (url.pathname === '/dimase/device-logs' && request.method === 'GET') {
        const sessionUser = await getSiteSession(request, env).catch(() => null);
        if (!sessionUser || !sessionUser.is_admin) return new Response('Unauthorized', { status: 401 });
        let rows = [];
        try { const r = await env.DB.prepare('SELECT * FROM flipper_device_logs ORDER BY ts DESC LIMIT 500').all(); rows = r.results || []; } catch {}
        const devices = [...new Set(rows.map(r => r.device_name || r.device_id))].map(d => `<option>${d}</option>`).join('');
        const rowsHtml = rows.map(r => `<tr><td class="ts">${new Date(r.ts).toLocaleString()}</td><td class="dev">${r.device_name||r.device_id||'?'}</td><td class="type">${r.log_type||''}</td><td class="act">${r.action||''}</td><td>${(r.detail||'').slice(0,120)}</td><td class="${r.success?'ok':'fail'}">${r.success?'&#10003;':'&#10007;'}</td></tr>`).join('');
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Flipper Logs</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0d0d0d;color:#e0e0e0;font-family:monospace;padding:24px}h1{color:#D4AF37;margin-bottom:4px}p.sub{color:#666;font-size:.85rem;margin-bottom:16px}.f{display:flex;gap:10px;margin-bottom:14px}input,select{background:#1a1a1a;border:1px solid #333;color:#e0e0e0;padding:6px 10px;border-radius:4px;font-family:monospace}table{width:100%;border-collapse:collapse;font-size:.82rem}th{background:#1a1a1a;color:#D4AF37;padding:8px 10px;text-align:left;border-bottom:1px solid #333;position:sticky;top:0}td{padding:7px 10px;border-bottom:1px solid #1e1e1e}.ok{color:#4CAF7D}.fail{color:#CF4455}.ts{color:#888;white-space:nowrap}.dev{color:#D4AF37;font-weight:600}.type{color:#0088ff}tr:hover td{background:#161616}</style></head><body><h1>Flipper Device Logs</h1><p class="sub">${rows.length} entries</p><div class="f"><input id="s" placeholder="Search..." oninput="f()"><select id="d" onchange="f()"><option value="">All Devices</option>${devices}</select></div><table><thead><tr><th>Time</th><th>Device</th><th>Type</th><th>Action</th><th>Detail</th><th>OK</th></tr></thead><tbody id="b">${rowsHtml}</tbody></table><script>function f(){const s=document.getElementById('s').value.toLowerCase(),d=document.getElementById('d').value.toLowerCase();document.querySelectorAll('#b tr').forEach(r=>{const t=r.textContent.toLowerCase();r.style.display=(t.includes(s)&&(!d||t.includes(d)))?'':'none'})}<\/script></body></html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });

      } else if (url.pathname === '/dimase/chat-ui') {
        // --- GET /dimase/chat-ui - Web Chat Interface ---
        if (request.method !== 'GET') return corsApiResponse({ error: 'Method not allowed' }, 405);
        const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>DiMase AI</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{background:#0a0a0f;color:#e0e0e0;font-family:\'Courier New\',monospace;height:100vh;display:flex;flex-direction:column}\nheader{background:#111;border-bottom:1px solid #333;padding:12px 20px;display:flex;align-items:center;gap:12px}\n.logo{width:32px;height:32px;background:linear-gradient(135deg,#00ff88,#0088ff);border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#000;font-size:14px}\nh1{font-size:18px;color:#00ff88}\n.sub{font-size:11px;color:#666;margin-top:2px}\n#chat{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px}\n.msg{max-width:80%;padding:12px 16px;border-radius:12px;line-height:1.5;font-size:14px;white-space:pre-wrap}\n.user{align-self:flex-end;background:#1a2a3a;border:1px solid #0088ff33;color:#aaddff}\n.dimase{align-self:flex-start;background:#1a2a1a;border:1px solid #00ff8833;color:#aaffcc}\n.dimase .name{font-size:11px;color:#00ff88;margin-bottom:6px;font-weight:bold}\n.typing{align-self:flex-start;padding:12px 16px;background:#1a2a1a;border:1px solid #00ff8833;border-radius:12px;color:#555}\n.typing span{animation:blink 1s infinite}\n.typing span:nth-child(2){animation-delay:.2s}\n.typing span:nth-child(3){animation-delay:.4s}\n@keyframes blink{0%,100%{opacity:.2}50%{opacity:1}}\nfooter{background:#111;border-top:1px solid #333;padding:12px 20px;display:flex;gap:12px}\n#inp{flex:1;background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:10px 14px;color:#e0e0e0;font-family:inherit;font-size:14px;outline:none;transition:border .2s}\n#inp:focus{border-color:#0088ff}\nbutton{background:#00ff88;color:#000;border:none;border-radius:8px;padding:10px 20px;font-family:inherit;font-weight:bold;cursor:pointer;transition:opacity .2s}\nbutton:hover{opacity:.8}\nbutton:disabled{opacity:.4;cursor:not-allowed}\ncode,pre{background:#0d1117;padding:2px 6px;border-radius:4px;font-size:13px}\n.credit{text-align:center;padding:6px;font-size:10px;color:#333}\n</style>\n</head>\n<body>\n<header>\n<div class="logo">A</div>\n<div><h1>DiMase AI</h1><div class="sub">DiMase Inc. Master Controller</div></div>\n</header>\n<div id="chat"></div>\n<footer>\n<input id="inp" placeholder="Message DiMase..." autocomplete="off"/>\n<button id="btn" onclick="send()">Send</button>\n</footer>\n<div class="credit">DiMase AI &middot; DiMase Inc.</div>\n<script>\nconst chat=document.getElementById(\'chat\');\nconst inp=document.getElementById(\'inp\');\nconst btn=document.getElementById(\'btn\');\nlet history=[];\ninp.addEventListener(\'keydown\',e=>{if(e.key===\'Enter\'&&!e.shiftKey){e.preventDefault();send()}});\nfunction addMsg(role,text){\n  const d=document.createElement(\'div\');\n  d.className=\'msg \'+role;\n  if(role===\'dimase\'){const n=document.createElement(\'div\');n.className=\'name\';n.textContent=\'DIMASE\';d.appendChild(n)}\n  const t=document.createElement(\'div\');t.textContent=text;d.appendChild(t);\n  chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d;\n}\nfunction showTyping(){\n  const d=document.createElement(\'div\');d.className=\'typing\';d.id=\'typing\';\n  d.innerHTML=\'<span>&#9679;</span><span>&#9679;</span><span>&#9679;</span>\';\n  chat.appendChild(d);chat.scrollTop=chat.scrollHeight;\n}\nasync function send(){\n  const msg=inp.value.trim();if(!msg)return;\n  inp.value=\'\';btn.disabled=true;\n  addMsg(\'user\',msg);showTyping();\n  history.push({role:\'user\',content:msg});\n  try{\n    const r=await fetch(\'/dimase/bot-chat\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\',\'X-Bot-Secret\':\'dimase-bot-2026\'},body:JSON.stringify({message:msg,history:history.slice(-10)})});\n    const data=await r.json();\n    const reply=data.response||\'Error: no response\';\n    document.getElementById(\'typing\')?.remove();\n    addMsg(\'dimase\',reply);\n    history.push({role:\'assistant\',content:reply});\n    if(history.length>20)history=history.slice(-20);\n  }catch(e){\n    document.getElementById(\'typing\')?.remove();\n    addMsg(\'dimase\',\'Connection error: \'+e.message);\n  }\n  btn.disabled=false;inp.focus();\n}\naddMsg(\'dimase\',\'Online. DiMase Inc. systems nominal. How can I help you?\');\n</script>\n</body>\n</html>\n';
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });

      } else if (url.pathname === '/dimase/call') {
        // --- GET /dimase/call - Browser Voice Call ---
        if (request.method !== 'GET') return corsApiResponse({ error: 'Method not allowed' }, 405);
        const callHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>DiMase AI &mdash; Voice Call</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;user-select:none}.av{width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,#00ff88,#0088ff);display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:bold;color:#000;margin-bottom:24px;position:relative}.ring{position:absolute;border-radius:50%;border:3px solid #00ff8866;width:100%;height:100%;animation:ring 2s ease-out infinite;display:none}.ring2{animation-delay:1s}@keyframes ring{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.9);opacity:0}}.nm{font-size:28px;font-weight:300;letter-spacing:1px;margin-bottom:6px}.sb{font-size:13px;color:#666;margin-bottom:24px}.st{font-size:15px;color:#00ff88;min-height:22px;margin-bottom:6px}.tm{font-size:13px;color:#555;min-height:20px;margin-bottom:24px;font-variant-numeric:tabular-nums}.tx{width:88%;max-width:380px;min-height:48px;max-height:100px;overflow-y:auto;background:rgba(255,255,255,.04);border-radius:14px;padding:12px 16px;font-size:14px;color:#999;text-align:center;line-height:1.5;margin-bottom:32px;display:none}.ctl{display:flex;gap:24px;align-items:center;flex-wrap:wrap;justify-content:center}.btn{width:68px;height:68px;border-radius:50%;border:none;cursor:pointer;font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .1s,opacity .2s,background .2s;outline:none}.btn:active{transform:scale(.91)}.btn-c{background:#00c853}.btn-h{background:#e53935;display:none}.btn-m{background:rgba(255,255,255,.12);border:2px solid #333;font-size:20px;width:52px;height:52px;display:none}.btn-m.on{background:#333}.btn-stop{background:#e65100;width:56px;height:56px;font-size:22px;display:none;animation:pulse-stop .8s infinite alternate}.btn-stop:hover{background:#ff6d00}@keyframes pulse-stop{from{box-shadow:0 0 0 0 rgba(230,81,0,.5)}to{box-shadow:0 0 0 10px rgba(230,81,0,0)}}.hint{font-size:11px;color:#444;margin-top:16px;text-align:center}.nosup{text-align:center;padding:30px;color:#ff6b6b;font-size:15px;line-height:1.8}.nosup a{color:#00ff88;text-decoration:none}</style></head><body><div class="av" id="av">A<div class="ring" id="r1"></div><div class="ring ring2" id="r2"></div></div><div class="nm">DiMase AI</div><div class="sb" id="sb">DiMase Inc. &mdash; Voice</div><div class="st" id="st"></div><div class="tm" id="tm"></div><div class="tx" id="tx"></div><div class="ctl"><button class="btn btn-m" id="mb" onclick="toggleMute()" title="Mute mic">&#127908;</button><button class="btn btn-stop" id="sb2" onclick="interrupt()" title="Interrupt &amp; stop speaking">&#9646;&#9646;</button><button class="btn btn-c" id="cb" onclick="startCall()" title="Call DiMase">&#128222;</button><button class="btn btn-h" id="hb" onclick="endCall()" title="Hang up">&#128245;</button></div><div class="hint" id="hint"></div><script>const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){document.body.innerHTML='<div class="nosup">Voice calls need Chrome or Safari.<br><br><a href="/dimase/chat-ui">Use text chat instead \u2192</a></div>';}const syn=window.speechSynthesis;let rec,active=false,muted=false,isSpeaking=false,tSec=0,tInt,hist=[];const $=id=>document.getElementById(id);const setSt=s=>$('st').textContent=s;function tick(){const m=String(Math.floor(tSec/60)).padStart(2,'0'),s=String(tSec%60).padStart(2,'0');$('tm').textContent=m+':'+s;}function showTx(t,who){const e=$('tx');e.style.display='block';e.textContent=(who==='you'?'You: ':'DiMase: ')+t;}function pickVoice(){const vs=syn.getVoices();return vs.find(v=>/david|james|mark|daniel|aaron|rishi|fred|bruce|albert/i.test(v.name)&&/en/i.test(v.lang))||vs.find(v=>/male/i.test(v.name)&&/en/i.test(v.lang))||vs.find(v=>v.name==='Google US English')||vs.find(v=>/en.US/i.test(v.lang))||vs[0];}function startCall(){active=true;$('cb').style.display='none';$('hb').style.display='flex';$('mb').style.display='flex';$('tx').style.display='block';$('sb').textContent='Connected';$('r1').style.display=$('r2').style.display='block';tInt=setInterval(()=>{tSec++;tick();},1000);speak('Connected. DiMase Inc. systems nominal. How can I help you?');}function endCall(){active=false;if(rec)try{rec.stop();}catch(e){}syn.cancel();isSpeaking=false;clearInterval(tInt);$('cb').style.display='flex';$('hb').style.display='none';$('mb').style.display='none';$('sb2').style.display='none';$('r1').style.display=$('r2').style.display='none';$('tx').style.display='none';$('sb').textContent='DiMase Inc. \u2014 Voice';setSt('');$('tm').textContent='';$('hint').textContent='';tSec=0;hist=[];}function toggleMute(){muted=!muted;$('mb').textContent=muted?'\ud83d\udd07':'\ud83c\udfa4';$('mb').classList.toggle('on',muted);if(muted){try{rec&&rec.stop();}catch(e){}setSt('Muted');}else if(active&&!isSpeaking)listen();}function interrupt(){if(!active)return;syn.cancel();isSpeaking=false;$('sb2').style.display='none';$('hint').textContent='';setSt('Interrupted');showTx('(interrupted)','dimase');setTimeout(()=>{if(active&&!muted)listen();},300);}function speak(text){isSpeaking=true;setSt('DiMase is speaking...');$('sb2').style.display='flex';$('hint').textContent='Tap \u23f8\u23f8 to interrupt';showTx(text,'dimase');syn.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=1.0;u.pitch=0.9;const v=pickVoice();if(v)u.voice=v;u.onend=()=>{isSpeaking=false;$('sb2').style.display='none';$('hint').textContent='';if(active&&!muted)setTimeout(listen,700);};u.onerror=()=>{isSpeaking=false;$('sb2').style.display='none';$('hint').textContent='';if(active&&!muted)setTimeout(listen,500);};syn.speak(u);}function listen(){if(!active||muted||isSpeaking)return;setSt('Listening...');$('hint').textContent='Speak now';rec=new SR();rec.lang='en-US';rec.continuous=false;rec.interimResults=false;rec.onresult=async e=>{const txt=e.results[0][0].transcript.trim();if(!txt||!active)return;$('hint').textContent='';showTx(txt,'you');setSt('DiMase is thinking...');hist.push({role:'user',content:txt});try{const r=await fetch('/dimase/bot-chat',{method:'POST',headers:{'Content-Type':'application/json','X-Bot-Secret':'dimase-bot-2026'},body:JSON.stringify({message:txt,history:hist.slice(-10)})});const d=await r.json();const reply=d.response||'Sorry, no response.';hist.push({role:'assistant',content:reply});if(hist.length>20)hist=hist.slice(-20);if(active)speak(reply);}catch(err){if(active)speak('Connection error. Please try again.');}};rec.onerror=e=>{if(!active)return;if(e.error==='no-speech'){if(active&&!muted)setTimeout(listen,400);}else if(e.error!=='aborted'){setSt('Mic error: '+e.error);setTimeout(()=>{if(active&&!muted)listen();},2000);}};rec.onend=()=>{if(active&&!muted&&!isSpeaking)setTimeout(listen,400);};try{rec.start();}catch(e){}}syn.getVoices();if('onvoiceschanged' in syn)syn.onvoiceschanged=()=>syn.getVoices();</script></body></html>`;
        return new Response(callHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });

      } else if (url.pathname === '/dimase/messenger') {
        // --- /dimase/messenger - Facebook Messenger webhook ---
        if (request.method === 'GET') {
          const mode = url.searchParams.get('hub.mode');
          const token = url.searchParams.get('hub.verify_token');
          const challenge = url.searchParams.get('hub.challenge');
          if (mode === 'subscribe' && token === env.MESSENGER_VERIFY_TOKEN) {
            return new Response(challenge, { status: 200 });
          }
          return new Response('Verification failed', { status: 403 });
        }
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          if (body.object === 'page' && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
              const messaging = entry.messaging || [];
              for (const event of messaging) {
                if (event.message && event.message.text) {
                  const senderId = event.sender.id;
                  const text = event.message.text;
                  try {
                    const reply = await callDiMaseAI(text, [], env);
                    await fetch('https://graph.facebook.com/v18.0/me/messages', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + (env.MESSENGER_PAGE_ACCESS_TOKEN || ''),
                      },
                      body: JSON.stringify({
                        recipient: { id: senderId },
                        message: { text: reply.substring(0, 2000) },
                      }),
                    });
                  } catch (_) {}
                }
              }
            }
          }
          return new Response('EVENT_RECEIVED', { status: 200 });
        }
        return new Response('Method not allowed', { status: 405 });

      } else if (url.pathname === '/dimase/sms') {
        // --- POST /dimase/sms - Twilio SMS webhook ---
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        const raw = await request.text();
        const params = new URLSearchParams(raw);
        const body = params.get('Body') || '';
        const reply = await callDiMaseAI(body, [], env);
        const safeReply = reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safeReply}</Message></Response>`,
          { headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        );

      } else if (url.pathname === '/dimase/voice') {
        // --- POST /dimase/voice - Twilio Voice initial webhook ---
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello, this is DiMase AI. How can I help you?</Say>
  <Gather input="speech" action="/dimase/voice/gather" timeout="5" speechTimeout="auto">
    <Say>Please speak your message after the tone.</Say>
  </Gather>
</Response>`,
          { headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        );

      } else if (url.pathname === '/dimase/voice/gather') {
        // --- POST /dimase/voice/gather - Twilio Voice speech gather ---
        const raw = await request.text();
        const params = new URLSearchParams(raw);
        const speechResult = params.get('SpeechResult') || '';
        const reply = speechResult
          ? await callDiMaseAI(speechResult, [], env)
          : 'I did not catch that. Please try again.';
        const safeReply = reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${safeReply}</Say>
  <Gather input="speech" action="/dimase/voice/gather" timeout="5" speechTimeout="auto">
    <Say>Anything else?</Say>
  </Gather>
</Response>`,
          { headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
        );
      } else if (url.pathname === '/dimase/notify-sms' && request.method === 'POST') {
        const secret = request.headers.get('X-Bot-Secret');
        if (secret !== env.DIMASE_BOT_SECRET) return new Response('Unauthorized', {status:401});
        let body; try { body = await request.json(); } catch { return new Response('Bad JSON', {status:400}); }
        const text = body.text || 'DiMase notification';
        await sendOwnerSMS(text, env);
        return corsApiResponse({ ok: true });
      } else {
        const mediaResult = await handleDiMaseMedia(request, env, url);
        if (mediaResult) return mediaResult;
      }
      return corsApiResponse({ error: 'Not found' }, 404);
    }

    // Learning API routes
    if (url.pathname.startsWith('/lms/')) {
      const apiResult = await handleLearningApi(request, env, url);
      if (apiResult) return apiResult;
      return apiResponse({ error: 'Not found' }, 404);
    }

  // Computer Basics API routes
    if (url.pathname.startsWith('/cb/')) {
      const apiResult = await handleComputerBasicsApi(request, env, url);
      if (apiResult) return apiResult;
      return apiResponse({ error: 'Not found' }, 404);
    }

    // Chatbot Builder API routes
    if (url.pathname.startsWith('/chatbot/')) {
      const apiResult = await handleChatbotBuilderApi(request, env, url);
      if (apiResult) return apiResult;
      return apiResponse({ error: 'Not found' }, 404);
    }

    // Typing Mastery API routes
    if (url.pathname.startsWith('/typing/')) {
      const apiResult = await handleTypingApi(request, env, url);
      if (apiResult) return apiResult;
      return apiResponse({ error: 'Not found' }, 404);
    }

    if (url.pathname.startsWith('/esl/')) {
      const eslResult = await handleEslApi(request, env, url);
      if (eslResult) return eslResult;
      return apiResponse({ error: 'Not found' }, 404);
    }

    if (url.pathname.startsWith('/reading/')) {
      const readingResp = await handleReadingApi(request, env, url);
      if (readingResp) return readingResp;
      return apiResponse({ error: 'Not found' }, 404);
    }

    // Public podcast listener page
    if (url.pathname === '/podcast' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM podcast_episodes ORDER BY episode_number DESC, pub_date DESC').all();
      return new Response(podcastPageHTML(results || []), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    // Podcast API routes
    if (url.pathname.startsWith('/podcast')) {
      const REC_API = 'https://rec-api.dimaseinc.org';
      const REC_SECRET = 'dmsinc-rec-2026';

      // Public: Podcast cover art
      if (url.pathname === '/podcast-cover.jpg') {
        const cover = await fetch('https://downloads.dimaseinc.org/podcast-cover.jpg');
        if (cover.ok) return new Response(cover.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
      }

      // Public: RSS feed
      if (url.pathname === '/podcast.rss' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM podcast_episodes ORDER BY episode_number DESC, pub_date DESC').all();
        return new Response(podcastRSSXML(results || []), {
          headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...SECURITY_HEADERS },
        });
      }

      // Public: serve episode audio files
      const audioMatch = url.pathname.match(/^\/podcast\/audio\/([^/]+)$/);
      if (audioMatch && request.method === 'GET') {
        const filename = audioMatch[1];
        try {
          const r = await fetch(`${REC_API}/audio/${encodeURIComponent(filename)}`);
          return new Response(r.body, {
            status: r.status,
            headers: {
              'Content-Type': r.headers.get('Content-Type') || 'audio/mpeg',
              'Content-Length': r.headers.get('Content-Length') || '',
              'Accept-Ranges': 'bytes',
            },
          });
        } catch { return new Response('Not found', { status: 404 }); }
      }

      // All management routes require cloud session
      const cloudSession = getCookie(request, 'cloud_session');
      const cloudSessionData = await validateSession(cloudSession);
      if (!cloudSessionData) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
        });
      }

      // GET /podcast/episodes
      if (url.pathname === '/podcast/episodes' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM podcast_episodes ORDER BY episode_number DESC, pub_date DESC').all();
        return apiResponse(results || []);
      }

      // POST /podcast/episodes
      if (url.pathname === '/podcast/episodes' && request.method === 'POST') {
        const { title, description, audio_url, filename, duration, file_size, episode_number, explicit } = await request.json();
        const pub_date = new Date().toUTCString();
        const result = await env.DB.prepare(
          'INSERT INTO podcast_episodes (title, description, audio_url, filename, duration, file_size, pub_date, episode_number, explicit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(title, description || '', audio_url, filename || '', duration || 0, file_size || 0, pub_date, episode_number || null, explicit ? 1 : 0).run();
        return apiResponse({ success: true, id: result.meta.last_row_id });
      }

      // DELETE /podcast/episodes/:id
      const delMatch = url.pathname.match(/^\/podcast\/episodes\/(\d+)$/);
      if (delMatch && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM podcast_episodes WHERE id = ?').bind(parseInt(delMatch[1])).run();
        return apiResponse({ success: true });
      }

      // Recording control — proxy to server rec API
      if (url.pathname === '/podcast/record/status' && request.method === 'GET') {
        try {
          const r = await fetch(`${REC_API}/status`, { headers: { 'X-Rec-Secret': REC_SECRET }, signal: AbortSignal.timeout(5000) });
          return apiResponse(await r.json());
        } catch { return apiResponse({ status: 'offline' }); }
      }

      if (url.pathname === '/podcast/record/start' && request.method === 'POST') {
        try {
          const r = await fetch(`${REC_API}/start`, { method: 'POST', headers: { 'X-Rec-Secret': REC_SECRET }, signal: AbortSignal.timeout(5000) });
          return apiResponse(await r.json());
        } catch { return apiResponse({ error: 'Server offline' }, 503); }
      }

      if (url.pathname === '/podcast/record/stop' && request.method === 'POST') {
        try {
          const r = await fetch(`${REC_API}/stop`, { method: 'POST', headers: { 'X-Rec-Secret': REC_SECRET }, signal: AbortSignal.timeout(30000) });
          return apiResponse(await r.json());
        } catch { return apiResponse({ error: 'Server offline' }, 503); }
      }

      // POST /podcast/upload — proxy raw MP3 upload to rec-api → /media/Storage/podcast/
      if (url.pathname === '/podcast/upload' && request.method === 'POST') {
        const filename = request.headers.get('X-Filename') || 'upload.mp3';
        try {
          const r = await fetch(`${REC_API}/upload`, {
            method: 'POST',
            headers: {
              'X-Rec-Secret': REC_SECRET,
              'X-Filename': filename,
              'Content-Type': request.headers.get('Content-Type') || 'audio/mpeg',
              'Content-Length': request.headers.get('Content-Length') || '0',
            },
            body: request.body,
          });
          return apiResponse(await r.json(), r.ok ? 200 : 500);
        } catch (e) { return apiResponse({ error: 'Upload failed: ' + e.message }, 503); }
      }
    }

    // API: APK info
    // Bundle code validation (used by locksmith.dimaseinc.org and /remote page)
    if (url.pathname === '/api/bundle/validate' && request.method === 'GET') {
      const c = (url.searchParams.get('code') || '').trim().toUpperCase();
      const t = (url.searchParams.get('type') || 'rdp').trim();
      if (!c) return corsApiResponse({ valid: false });
      try {
        const rec = await env.DB.prepare(
          "SELECT remaining_uses, name FROM bundle_codes WHERE code=? AND type=? AND remaining_uses>0"
        ).bind(c, t).first();
        if (rec) return corsApiResponse({ valid: true, remaining: rec.remaining_uses, name: rec.name });
      } catch(e) { console.error('bundle validate error', e); }
      return corsApiResponse({ valid: false });
    }

    // Bundle code use (decrements remaining_uses)
    if (url.pathname === '/api/bundle/use' && request.method === 'POST') {
      const su = await getSiteSession(request, env);
      let body = {};
      try { body = await request.json(); } catch {}
      // Allow use from /remote page (no auth required for RDP check-in) but verify code
      const c = (body.code || '').trim().toUpperCase();
      const t = (body.type || 'rdp').trim();
      if (!c) return corsApiResponse({ error: 'Missing code' }, 400);
      try {
        const rec = await env.DB.prepare(
          "SELECT * FROM bundle_codes WHERE code=? AND type=? AND remaining_uses>0"
        ).bind(c, t).first();
        if (!rec) return corsApiResponse({ error: 'Invalid or no remaining uses' }, 404);
        await env.DB.prepare(
          "UPDATE bundle_codes SET remaining_uses=remaining_uses-1, last_used_at=datetime('now') WHERE id=?"
        ).bind(rec.id).run();
        return corsApiResponse({ success: true, remaining: rec.remaining_uses - 1 });
      } catch(e) { return corsApiResponse({ error: 'DB error' }, 500); }
    }

    // GET /sitemap.xml
    if (url.pathname === '/sitemap.xml') {
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://dimaseinc.org/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://dimaseinc.org/subscribe</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>
  <url><loc>https://dimaseinc.org/login</loc><changefreq>yearly</changefreq><priority>0.5</priority></url>
  <url><loc>https://dimaseinc.org/register</loc><changefreq>yearly</changefreq><priority>0.5</priority></url>
  <url><loc>https://dimaseinc.org/support</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://dimaseinc.org/remote</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>https://dimaseinc.org/podcast.rss</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
</urlset>`;
      return new Response(sitemap, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    if (url.pathname === '/api/apk-info' && request.method === 'GET') {
      const apks = [
        { name: 'DiMase 2.0',       file: 'dimase-2.0.apk',               version: '2.0.0', downloadUrl: '/downloads/dimase-2.0.apk' },
        { name: 'DiMase Learning', file: 'DiMase Inc. Learning.apk',   version: '1.0', downloadUrl: '/downloads/DiMase%20Inc.%20Learning.apk' },
        { name: 'SmartCloud Map',  file: 'smartcloud-map.apk',          version: '1.0', downloadUrl: '/downloads/smartcloud-map.apk' },
      ];
      return corsApiResponse({ apks, updated: new Date().toISOString() });
    }

    // APK version check: GET /api/apk-check?app=DiMase+2.0&version=2.0
    if (url.pathname === '/api/apk-check' && request.method === 'GET') {
      const appName = url.searchParams.get('app') || '';
      const clientVersion = url.searchParams.get('version') || '0';
      const apks = [
        { name: 'DiMase 2.0',       version: '2.0.0', downloadUrl: '/downloads/dimase-2.0.apk' },
        { name: 'DiMase Learning', version: '1.0', downloadUrl: '/downloads/DiMase%20Inc.%20Learning.apk' },
        { name: 'SmartCloud Map',  version: '1.0', downloadUrl: '/downloads/smartcloud-map.apk' },
      ];
      const apk = apks.find(a => a.name.toLowerCase() === appName.toLowerCase());
      if (!apk) return corsApiResponse({ error: 'App not found' }, 404);
      const hasUpdate = apk.version !== clientVersion;
      return corsApiResponse({ app: apk.name, latest: apk.version, current: clientVersion, hasUpdate, downloadUrl: hasUpdate ? apk.downloadUrl : null });
    }

    // Proxy file downloads from server (ASSETS binding doesn't serve large binaries)
    if (url.pathname.startsWith('/downloads/') && (url.pathname.endsWith('.apk') || url.pathname.endsWith('.zip') || url.pathname.endsWith('.tar.gz'))) {
      const filename = url.pathname.replace('/downloads/', '');
      const serverUrl = 'https://downloads.dimaseinc.org/' + filename + (url.search || '');
      try {
        const resp = await fetch(serverUrl);
        if (resp.ok) {
          const headers = new Headers();
          let ct = 'application/octet-stream';
          if (filename.endsWith('.apk')) ct = 'application/vnd.android.package-archive';
          else if (filename.endsWith('.zip')) ct = 'application/zip';
          else if (filename.endsWith('.tar.gz')) ct = 'application/gzip';
          headers.set('Content-Type', ct);
          headers.set('Content-Disposition', 'attachment; filename="' + decodeURIComponent(filename) + '"');
          headers.set('Cache-Control', 'public, max-age=3600');
          const size = resp.headers.get('Content-Length');
          if (size) headers.set('Content-Length', size);
          return new Response(resp.body, { status: 200, headers });
        }
      } catch(e) {}
      return new Response('File not found', { status: 404 });
    }

    // Site auth gate for HTML pages served from static assets
    {
      const p = url.pathname;
      const publicPrefixes = ['/map', '/podcast', '/login', '/register', '/site-logout', '/subscribe', '/paypal', '/support', '/downloads', '/api', '/remote', '/sitemap.xml', '/dimase-deploy', '/dimase-antivirus', '/ann-reads', '/ann'];
      const isPublicPath = publicPrefixes.some(pp => p === pp || p.startsWith(pp + '/') || p.startsWith(pp + '.')) || p === '/podcast.rss' || p === '/';
      const isStaticAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|avif|mp4|webm|json|txt|map|xml|apk)$/.test(p);
      if (!isPublicPath && !isStaticAsset) {
        const su = await getSiteSession(request, env);
        if (!su) {
          const loginUrl = '/login?r=' + encodeURIComponent(p);
          return Response.redirect(url.origin + loginUrl, 302);
        }
        if (!isAccessAllowed(su)) return Response.redirect(url.origin + '/subscribe', 302);
      }
    }

    // Everything else: serve static assets
    return env.ASSETS.fetch(request);
  },

  async email(message, env, ctx) {
    try {
      const from = message.from;
      const subject = message.headers.get('subject') || 'No subject';

      // Read raw email and extract plain text body
      const rawEmail = await new Response(message.raw).text();
      const bodyParts = rawEmail.split(/\r?\n\r?\n/);
      let body = bodyParts.slice(1).join('\n').replace(/<[^>]+>/g, '').trim().substring(0, 2000) || subject;

      // Call DiMase AI
      const reply = await callDiMaseAI(`Email from ${from}: ${body}`, [], env);

      // Reply to sender via MailChannels
      await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: from }] }],
          from: { email: 'dimase@dimaseinc.org', name: 'DiMase AI' },
          subject: `Re: ${subject}`,
          content: [{ type: 'text/plain', value: reply }]
        })
      });

      // Notify owner via Telegram
      const tgToken = env.TELEGRAM_BOT_TOKEN;
      const tgChat = env.TELEGRAM_CHAT_ID;
      if (tgToken && tgChat) {
        const tgMsg = `\u{1F4E7} *Email from:* ${from}\n*Subject:* ${subject}\n\n*DiMase replied:*\n${reply.substring(0, 800)}`;
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChat, text: tgMsg, parse_mode: 'Markdown' })
        });
      }
    } catch(e) {
      // Log error but don't fail
      console.error('Email handler error:', e);
    }
  },
};

function podcastRSSXML(episodes) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = episodes.map(ep => `
    <item>
      <title>${esc(ep.title)}</title>
      <description>${esc(ep.description)}</description>
      <enclosure url="${esc(ep.audio_url)}" length="${ep.file_size || 0}" type="audio/mpeg"/>
      <guid isPermaLink="false">dimaseinc-ep-${ep.id}</guid>
      <pubDate>${ep.pub_date}</pubDate>
      ${ep.duration ? `<itunes:duration>${ep.duration}</itunes:duration>` : ''}
      ${ep.episode_number ? `<itunes:episode>${ep.episode_number}</itunes:episode>` : ''}
      <itunes:explicit>${ep.explicit ? 'true' : 'false'}</itunes:explicit>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>DiMase Inc. Podcast</title>
    <link>https://dimaseinc.org</link>
    <description>The DiMase Inc. Podcast — Technology, innovation, and digital solutions.</description>
    <language>en-us</language>
    <itunes:author>DiMase Inc.</itunes:author>
    <itunes:category text="Technology"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:owner><itunes:name>DiMase Inc.</itunes:name><itunes:email>dimaseinc@gmail.com</itunes:email></itunes:owner>
    <itunes:image href="https://dimaseinc.org/podcast-cover.jpg"/>
    <atom:link href="https://dimaseinc.org/podcast.rss" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;
}

function podcastPageHTML(episodes) {
  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtDur = s => { if (!s) return ''; const m = Math.floor(s/60), sec = s%60; return m + ':' + String(sec).padStart(2,'0'); };
  const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}); } catch { return d||''; } };

  const episodeCards = episodes.length ? episodes.map((ep, i) => `
    <div class="ep-card" id="ep-${ep.id}">
      <div class="ep-num">${ep.episode_number ? 'EP ' + ep.episode_number : ''}</div>
      <div class="ep-body">
        <div class="ep-title">${esc(ep.title)}</div>
        <div class="ep-date">${fmtDate(ep.pub_date)}${ep.duration ? ' &middot; ' + fmtDur(ep.duration) : ''}</div>
        ${ep.description ? `<div class="ep-desc">${esc(ep.description)}</div>` : ''}
        <div class="ep-player">
          <audio controls preload="none" style="width:100%;margin-top:12px;accent-color:#d4af37">
            <source src="${esc(ep.audio_url)}" type="audio/mpeg">
            Your browser does not support audio.
          </audio>
        </div>
      </div>
    </div>`).join('') : `<div class="no-eps">No episodes yet — check back soon.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DiMase Inc. Podcast</title>
  <meta name="description" content="The DiMase Inc. Podcast — Technology, innovation, and digital solutions.">
  <link rel="alternate" type="application/rss+xml" title="DiMase Inc. Podcast" href="/podcast.rss">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--gold:#d4af37;--gold-light:#f4d03f;--black:#0a0a0a;--black-light:#1a1a1a;--black-lighter:#2a2a2a;--text:#ffffff;--text-muted:#a0a0a0;--border:#333333}
    body{font-family:'Inter',sans-serif;background:var(--black);color:var(--text);min-height:100vh}
    .header{background:rgba(10,10,10,0.95);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
    .nav{max-width:900px;margin:0 auto;padding:0 24px;display:flex;justify-content:space-between;align-items:center;height:64px}
    .logo{color:var(--gold);font-weight:700;font-size:1.1rem;text-decoration:none;letter-spacing:1px}
    .nav-home{color:var(--text-muted);font-size:0.85rem;text-decoration:none;transition:color 0.2s}
    .nav-home:hover{color:var(--text)}
    .hero{border-bottom:1px solid var(--border);padding:64px 24px 48px;text-align:center;background:radial-gradient(ellipse at top,rgba(212,175,55,0.08) 0%,transparent 70%)}
    .hero-icon{width:72px;height:72px;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
    .hero h1{font-size:2.2rem;font-weight:700;margin-bottom:12px}
    .hero h1 span{color:var(--gold)}
    .hero p{color:var(--text-muted);font-size:1rem;max-width:480px;margin:0 auto 28px;line-height:1.6}
    .subscribe-btn{display:inline-flex;align-items:center;gap:8px;background:var(--gold);color:var(--black);padding:10px 22px;font-weight:700;font-size:0.85rem;text-decoration:none;text-transform:uppercase;letter-spacing:1px;transition:opacity 0.2s}
    .subscribe-btn:hover{opacity:0.85}
    .rss-link{display:inline-flex;align-items:center;gap:6px;color:var(--text-muted);font-size:0.8rem;text-decoration:none;border:1px solid var(--border);padding:10px 18px;margin-left:10px;transition:all 0.2s}
    .rss-link:hover{color:var(--gold);border-color:var(--gold)}
    .container{max-width:900px;margin:0 auto;padding:48px 24px}
    .section-title{font-size:0.75rem;text-transform:uppercase;letter-spacing:3px;color:var(--text-muted);margin-bottom:28px;display:flex;align-items:center;gap:12px}
    .section-title::after{content:'';flex:1;height:1px;background:var(--border)}
    .episodes{display:flex;flex-direction:column;gap:2px}
    .ep-card{display:flex;gap:20px;background:var(--black-light);border:1px solid var(--border);padding:28px;transition:border-color 0.2s}
    .ep-card:hover{border-color:rgba(212,175,55,0.4)}
    .ep-num{font-size:0.7rem;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:2px;min-width:40px;padding-top:3px}
    .ep-body{flex:1}
    .ep-title{font-size:1.05rem;font-weight:600;margin-bottom:6px}
    .ep-date{font-size:0.78rem;color:var(--text-muted);margin-bottom:10px}
    .ep-desc{font-size:0.88rem;color:var(--text-muted);line-height:1.6;margin-bottom:4px}
    .no-eps{text-align:center;padding:80px 24px;color:var(--text-muted);font-size:0.95rem}
    .apps-section{margin-top:56px;padding-top:40px;border-top:1px solid var(--border)}
    .apps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:20px}
    .app-chip{background:var(--black-light);border:1px solid var(--border);padding:14px 18px;font-size:0.82rem;color:var(--text-muted);text-align:center;line-height:1.4}
    .app-chip strong{display:block;color:var(--text);margin-bottom:2px;font-size:0.85rem}
    footer{border-top:1px solid var(--border);padding:32px 24px;text-align:center;color:var(--text-muted);font-size:0.8rem}
    footer a{color:var(--gold);text-decoration:none}
    audio::-webkit-media-controls-panel{background:#1a1a1a}
    @media(max-width:600px){.ep-card{flex-direction:column;gap:8px}.ep-num{min-width:auto}.hero h1{font-size:1.6rem}}
  </style>
</head>
<body>
  <header class="header">
    <nav class="nav">
      <a href="/" class="logo">DiMase Inc.</a>
      <a href="/" class="nav-home">← Back to site</a>
    </nav>
  </header>

  <section class="hero">
    <div class="hero-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d4af37" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm6 11a6 6 0 0 1-12 0M12 19v4m-4 0h8"/></svg>
    </div>
    <h1>DiMase Inc. <span>Podcast</span></h1>
    <p>Technology, innovation, and digital solutions. New episodes on everything we're building.</p>
    <div>
      <a href="/podcast.rss" class="subscribe-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/></svg>
        Subscribe via RSS
      </a>
      <a href="https://podcasts.apple.com/search?term=DiMase+Inc" target="_blank" class="rss-link">Apple Podcasts</a>
      <a href="https://open.spotify.com/show/1fSOrw2QQaOHY5rrn6MXZ9" target="_blank" class="rss-link" style="color:#1DB954;border-color:#1DB954;"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Listen on Spotify</a>
    </div>
  </section>

  <div class="container">
    <div class="section-title">Episodes</div>
    <div class="episodes">
      ${episodeCards}
    </div>

    <div class="apps-section">
      <div class="section-title">Add to your podcast app</div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px">Copy the RSS feed URL into any podcast app to subscribe:</p>
      <div style="background:var(--black-light);border:1px solid var(--border);padding:14px 18px;font-family:monospace;font-size:0.85rem;color:var(--gold);user-select:all;margin-bottom:20px">https://dimaseinc.org/podcast.rss</div>
      <div class="apps-grid">
        <div class="app-chip"><strong>Apple Podcasts</strong>Add RSS feed in Library</div>
        <div class="app-chip"><strong>Spotify</strong>Search "DiMase Inc"</div>
        <div class="app-chip"><strong>Pocket Casts</strong>Add via RSS URL</div>
        <div class="app-chip"><strong>Overcast</strong>Add via RSS URL</div>
        <div class="app-chip"><strong>Castro</strong>Paste RSS link</div>
        <div class="app-chip"><strong>Any Podcast App</strong>Paste the RSS URL</div>
      </div>
    </div>
  </div>

  <footer>
    <p>&copy; 2026 <a href="/">DiMase Inc.</a> &mdash; <a href="/podcast.rss">RSS Feed</a></p>
  </footer>
</body>
</html>`;
}

function loginPageHTML(title, icon, authBase) {
  const iconSvg = icon === 'ai'
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line></svg>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | DiMase Inc.</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --gold: #d4af37; --gold-light: #f4d03f; --gold-dark: #b8960c;
      --black: #0a0a0a; --black-light: #1a1a1a; --black-lighter: #2a2a2a;
      --text: #ffffff; --text-muted: #a0a0a0; --border: #333333;
      --red: #ef4444;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--black); color: var(--text); min-height: 100vh;
      display: flex; flex-direction: column;
    }
    .header {
      background: rgba(10,10,10,0.9); backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }
    .nav {
      display: flex; justify-content: space-between; align-items: center;
      height: 70px; max-width: 1200px; margin: 0 auto; padding: 0 20px;
    }
    .logo {
      display: flex; align-items: center; gap: 10px;
      font-size: 1.5rem; font-weight: 700; color: var(--gold);
      text-decoration: none; letter-spacing: 1px;
    }
    .nav-links { display: flex; list-style: none; gap: 2rem; }
    .nav-links a {
      color: var(--text); text-decoration: none; font-weight: 500;
      text-transform: uppercase; letter-spacing: 1px; font-size: 0.9rem;
      transition: color 0.3s;
    }
    .nav-links a:hover { color: var(--gold); }
    .login-container {
      flex: 1; display: flex; align-items: center; justify-content: center; padding: 2rem;
    }
    .login-box {
      background: linear-gradient(135deg, var(--black-light), var(--black-lighter));
      border: 1px solid var(--border); padding: 3rem; width: 100%; max-width: 420px;
    }
    .login-box h1 {
      font-size: 1.5rem; text-transform: uppercase; letter-spacing: 3px;
      color: var(--gold); margin-bottom: 0.5rem; text-align: center;
    }
    .subtitle {
      color: var(--text-muted); text-align: center; margin-bottom: 2rem;
      font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px;
    }
    .terminal-icon {
      text-align: center; margin-bottom: 1.5rem; font-size: 3rem;
    }
    .terminal-icon svg { stroke: var(--gold); }
    .form-group { margin-bottom: 1.5rem; }
    .form-group label {
      display: block; font-weight: 500; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 1px; font-size: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .form-group input {
      width: 100%; padding: 14px 18px; border: 1px solid var(--border);
      background: var(--black); color: var(--text);
      font-family: 'Courier New', monospace; font-size: 1rem;
      transition: border-color 0.3s, box-shadow 0.3s; outline: none;
    }
    .form-group input:focus {
      border-color: var(--gold); box-shadow: 0 0 20px rgba(212,175,55,0.2);
    }
    .login-btn {
      width: 100%; padding: 16px; background: transparent; color: var(--gold);
      border: 2px solid var(--gold); font-family: inherit; font-size: 1rem;
      font-weight: 600; text-transform: uppercase; letter-spacing: 2px;
      cursor: pointer; transition: all 0.3s;
    }
    .login-btn:hover {
      background: var(--gold); color: var(--black);
      box-shadow: 0 0 30px rgba(212,175,55,0.5);
    }
    .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error-msg {
      color: var(--red); text-align: center; margin-top: 1rem;
      font-size: 0.85rem; min-height: 1.2em;
    }
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .login-box { padding: 2rem 1.5rem; }
    }
  </style>
</head>
<body>
  <header class="header">
    <nav class="nav">
      <a href="/" class="logo">
        <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="50,2 93,27 93,73 50,98 7,73 7,27" stroke="#d4af37" stroke-width="3" fill="none"/><polygon points="50,12 83,32 83,68 50,88 17,68 17,32" stroke="#d4af37" stroke-width="1" fill="none" opacity="0.25"/><line x1="7" y1="27" x2="25" y2="36" stroke="#d4af37" stroke-width="1.5" opacity="0.4"/><line x1="7" y1="73" x2="25" y2="64" stroke="#d4af37" stroke-width="1.5" opacity="0.4"/><line x1="93" y1="27" x2="75" y2="36" stroke="#d4af37" stroke-width="1.5" opacity="0.4"/><line x1="93" y1="73" x2="75" y2="64" stroke="#d4af37" stroke-width="1.5" opacity="0.4"/><circle cx="25" cy="36" r="2.5" fill="#d4af37" opacity="0.6"/><circle cx="25" cy="64" r="2.5" fill="#d4af37" opacity="0.6"/><circle cx="75" cy="36" r="2.5" fill="#d4af37" opacity="0.6"/><circle cx="75" cy="64" r="2.5" fill="#d4af37" opacity="0.6"/><circle cx="50" cy="12" r="2" fill="#d4af37" opacity="0.4"/><circle cx="50" cy="88" r="2" fill="#d4af37" opacity="0.4"/><path d="M34,30 L34,70 L50,70 L65,60 L65,40 L50,30 Z" stroke="#d4af37" stroke-width="3.5" fill="none" stroke-linejoin="miter"/><line x1="40" y1="42" x2="56" y2="42" stroke="#d4af37" stroke-width="1.5" opacity="0.5"/><line x1="40" y1="50" x2="60" y2="50" stroke="#d4af37" stroke-width="2" opacity="0.7"/><line x1="40" y1="58" x2="56" y2="58" stroke="#d4af37" stroke-width="1.5" opacity="0.5"/><circle cx="60" cy="50" r="3" fill="#d4af37" opacity="0.9"/></svg>
        DiMase Inc.
      </a>
      <ul class="nav-links">
        <li><a href="/">Home</a></li>
      </ul>
    </nav>
  </header>
  <div class="login-container">
    <div class="login-box">
      <div class="terminal-icon">
        ${iconSvg}
      </div>
      <h1>${title}</h1>
      <p class="subtitle">Authorized Personnel Only</p>
      <form id="loginForm">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" autocomplete="username" autofocus required>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required>
        </div>
        <button type="submit" class="login-btn" id="loginBtn">Authenticate</button>
        <div class="error-msg" id="errorMsg"></div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const err = document.getElementById('errorMsg');
      btn.disabled = true;
      btn.textContent = 'Authenticating...';
      err.textContent = '';
      try {
        const res = await fetch('${authBase}/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
          }),
        });
        const data = await res.json();
        if (data.success) {
          btn.textContent = 'Connecting...';
          window.location.href = '${authBase}';
        } else {
          err.textContent = 'Access Denied: Invalid credentials';
          btn.disabled = false;
          btn.textContent = 'Authenticate';
        }
      } catch {
        err.textContent = 'Connection error';
        btn.disabled = false;
        btn.textContent = 'Authenticate';
      }
    });
  </script>
</body>
</html>`;
}


function cloudPanelHTML(basePath) {
  const services = [
    { name: 'VNC Desktop', url: 'https://vnc.dimaseinc.org/vnc.html', icon: 'M2 13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7zm6 3h4m-6 1h8', label: 'Remote Desktop' },
    { name: 'Jellyfin', url: 'https://jellyfin.dimaseinc.org', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', label: 'Media Server' },
    { name: 'Portainer', url: 'https://portainer.dimaseinc.org', icon: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', label: 'Docker' },
    { name: 'Grafana', url: 'https://neo.dimaseinc.org', icon: 'M3 3v18h18M18 9l-5 5-4-4-3 3', label: 'Monitoring' },
    { name: 'File Browser', url: 'https://files.dimaseinc.org', icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', label: 'Files' },
    { name: 'DiMase AI', url: 'https://dimase.dimaseinc.org', icon: 'M12 8V4H8M4 8h16M4 8v12h16V8M9 12v4m6-4v4', label: 'AI Agent' },
    { name: 'Downloads', url: '/applications.html', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3', label: 'APKs' },
    { name: 'Podcast', url: 'https://dimaseinc.org/podcast', icon: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm6 11a6 6 0 0 1-12 0M12 19v4m-4 0h8', label: 'RSS Feed' },
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloud Panel | DiMase Inc.</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --gold: #d4af37; --gold-light: #f4d03f; --gold-dark: #b8960c;
      --black: #0a0a0a; --black-light: #1a1a1a; --black-lighter: #2a2a2a;
      --text: #ffffff; --text-muted: #a0a0a0; --border: #333333;
    }
    body { font-family: -apple-system, system-ui, sans-serif; background: var(--black); color: var(--text); min-height: 100vh; }
    .container { max-width: 1100px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 1.1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; color: var(--gold); margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .card {
      background: var(--black-light); border: 1px solid var(--border);
      padding: 28px 20px; text-decoration: none; color: var(--text);
      transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 14px;
      text-align: center; border-radius: 8px;
    }
    .card:hover { border-color: var(--gold); background: var(--black-lighter); transform: translateY(-2px); }
    .card svg { color: var(--gold); }
    .card .name { font-weight: 600; font-size: 0.95rem; }
    .card .label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Cloud Panel</h1>
    <div class="grid">
      ${services.map(s => `
        <a href="${s.url}" class="card">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${s.icon}"/></svg>
          <span class="name">${s.name}</span>
          <span class="label">${s.label}</span>
        </a>
      `).join('')}
    </div>
  </div>
</body>
</html>`;
}

function embedPageHTML(title, embedUrl, basePath, isAdmin = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | DiMase Inc.</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --gold: #d4af37; --black: #0a0a0a; --black-light: #1a1a1a;
      --text: #ffffff; --text-muted: #a0a0a0; --border: #333333; --red: #ef4444;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--black); color: var(--text);
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }
    .toolbar {
      background: var(--black-light); border-bottom: 1px solid var(--border);
      padding: 0 16px; display: flex; justify-content: space-between;
      align-items: center; height: 48px; flex-shrink: 0;
    }
    .toolbar-left { display: flex; align-items: center; gap: 12px; }
    .toolbar-left a {
      color: var(--gold); text-decoration: none; font-weight: 700;
      text-transform: uppercase; letter-spacing: 2px; font-size: 0.85rem;
    }
    .toolbar-title {
      color: var(--text-muted); font-size: 0.8rem;
      text-transform: uppercase; letter-spacing: 1px;
    }
    .toolbar-right { display: flex; gap: 12px; align-items: center; }
    .toolbar-right a {
      color: var(--text-muted); text-decoration: none; font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 1px; padding: 4px 12px;
      border: 1px solid var(--border); transition: all 0.2s;
    }
    .toolbar-right a:hover { color: var(--text); border-color: var(--text); }
    .toolbar-right a.admin { color: var(--gold); border-color: var(--gold); cursor: pointer; }
    .toolbar-right a.admin:hover { background: var(--gold); color: var(--black); }
    .toolbar-right a.disconnect:hover { color: var(--red); border-color: var(--red); }
    iframe {
      flex: 1; width: 100%; border: none; background: var(--black);
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <a href="/">DiMase Inc.</a>
      <span class="toolbar-title">${title}</span>
    </div>
    <div class="toolbar-right">
      <a href="/">Home</a>

      <a href="${basePath}/logout" class="disconnect">Disconnect</a>
    </div>
  </div>
  <iframe id="ai-frame" src="${embedUrl}" allow="clipboard-read; clipboard-write"></iframe>
  <script>
    function openAdmin() {
      const frame = document.getElementById('ai-frame');
      try {
        frame.contentWindow.postMessage({ type: 'openSettings' }, '*');
      } catch(e) {}
      const base = frame.src.split('#')[0];
      frame.src = base + '#settings';
    }
  </script>
</body>
</html>`;
}

function landingPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DiMase Inc. — Technology. Innovation. Solutions.</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --gold: #d4af37; --gold-light: #f4d03f; --black: #0a0a0a; --black-light: #141414; --black-card: #1a1a1a; --text: #ffffff; --text-muted: #888; --border: #2a2a2a; }
    body { font-family: 'Inter', sans-serif; background: var(--black); color: var(--text); min-height: 100vh; overflow-x: hidden; }
    nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(10,10,10,0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); padding: 0 32px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
    .nav-logo { font-size: 0.9rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); text-decoration: none; }
    .nav-links { display: flex; gap: 12px; align-items: center; }
    .btn-nav { padding: 7px 20px; font-size: 0.78rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; text-decoration: none; border: 1px solid var(--border); color: var(--text-muted); transition: all 0.2s; }
    .btn-nav:hover { color: var(--text); border-color: var(--text); }
    .btn-nav.primary { background: var(--gold); color: #000; border-color: var(--gold); font-weight: 700; }
    .btn-nav.primary:hover { background: var(--gold-light); border-color: var(--gold-light); }
    .hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 100px 24px 80px; position: relative; overflow: hidden; }
    .hero::before { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; height: 600px; background: radial-gradient(circle, rgba(212,175,55,0.06) 0%, transparent 70%); pointer-events: none; }
    .hero-eyebrow { font-size: 0.7rem; letter-spacing: 4px; text-transform: uppercase; color: var(--gold); margin-bottom: 24px; }
    .hero h1 { font-size: clamp(2.5rem, 7vw, 5.5rem); font-weight: 800; line-height: 1.05; letter-spacing: -2px; max-width: 900px; }
    .hero h1 span { color: var(--gold); }
    .hero-sub { font-size: 1.1rem; color: var(--text-muted); max-width: 480px; margin: 24px auto; line-height: 1.7; font-weight: 400; }
    .hero-cta { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 40px; }
    .btn-primary { padding: 14px 36px; font-size: 0.9rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; text-decoration: none; background: var(--gold); color: #000; border: none; cursor: pointer; transition: all 0.2s; display: inline-block; }
    .btn-primary:hover { background: var(--gold-light); transform: translateY(-1px); }
    .btn-secondary { padding: 14px 36px; font-size: 0.9rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; text-decoration: none; color: var(--text-muted); border: 1px solid var(--border); background: none; cursor: pointer; transition: all 0.2s; display: inline-block; }
    .btn-secondary:hover { color: var(--text); border-color: var(--text); }
    .hero-video-section{display:flex;justify-content:center;align-items:center;padding:48px 24px 0;background:#000}
    .hero-video-wrap{max-width:320px;width:100%;border-radius:24px;overflow:hidden;box-shadow:0 0 60px rgba(212,175,55,0.15),0 0 0 1px rgba(212,175,55,0.1)}
    .hero-video{width:100%;display:block;border-radius:24px}
    .trial-badge { margin-top: 20px; font-size: 0.78rem; color: var(--text-muted); }
    .trial-badge span { color: var(--gold); font-weight: 600; }
    .features { padding: 100px 24px; background: var(--black-light); }
    .features-inner { max-width: 1100px; margin: 0 auto; }
    .section-label { font-size: 0.7rem; letter-spacing: 4px; text-transform: uppercase; color: var(--gold); margin-bottom: 16px; text-align: center; }
    .section-title { font-size: 2.2rem; font-weight: 700; text-align: center; margin-bottom: 64px; letter-spacing: -0.5px; }
    .feat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1px; background: var(--border); }
    .feat-card { background: var(--black-card); padding: 36px 28px; }
    .feat-icon { width: 40px; height: 40px; color: var(--gold); margin-bottom: 20px; }
    .feat-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 10px; }
    .feat-desc { font-size: 0.85rem; color: var(--text-muted); line-height: 1.7; }
    .pricing { padding: 100px 24px; }
    .pricing-inner { max-width: 480px; margin: 0 auto; text-align: center; }
    .pricing-card { background: var(--black-card); border: 1px solid var(--border); padding: 48px 36px; margin-top: 48px; position: relative; }
    .pricing-card::after { content: 'MOST POPULAR'; position: absolute; top: -1px; right: 28px; background: var(--gold); color: #000; font-size: 0.6rem; font-weight: 800; letter-spacing: 2px; padding: 4px 12px; }
    .price { font-size: 3.5rem; font-weight: 800; letter-spacing: -2px; }
    .price span { font-size: 1.2rem; font-weight: 400; color: var(--text-muted); vertical-align: super; font-size: 1.4rem; }
    .price-period { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }
    .pricing-features { list-style: none; margin: 32px 0; text-align: left; display: flex; flex-direction: column; gap: 12px; }
    .pricing-features li { font-size: 0.88rem; color: var(--text-muted); display: flex; gap: 10px; align-items: flex-start; }
    .pricing-features li::before { content: '✓'; color: var(--gold); font-weight: 700; flex-shrink: 0; }
    footer { border-top: 1px solid var(--border); padding: 32px 24px; text-align: center; font-size: 0.78rem; color: var(--text-muted); }
    footer a { color: var(--text-muted); text-decoration: none; }
    footer a:hover { color: var(--gold); }
  </style>
</head>
<body>
  <nav>
    <a class="nav-logo" href="/">DiMase Inc.</a>
    <div class="nav-links">
      <a class="btn-nav" href="/login">Log In</a>
      <a class="btn-nav primary" href="/register">Start Free Trial</a>
    </div>
  </nav>

  <section class="hero">
    <div class="hero-eyebrow">Welcome to DiMase Inc.</div>
    <h1>Technology.<br><span>Innovation.</span><br>Solutions.</h1>
    <p class="hero-sub">Your all-in-one platform for AI tools, media streaming, learning, and more — built for performance and reliability.</p>
    <div class="hero-cta">
      <a class="btn-primary" href="/register">Start Your Free Trial</a>
      <a class="btn-secondary" href="/login">Log In</a>
      <a class="btn-secondary" href="/dimase/call">&#128222; Talk to DiMase</a>
    </div>
    <div class="trial-badge"><span>7 days free</span> — then from $7/month. Cancel anytime.</div>
  </section>

  <section class="hero-video-section">
    <div class="hero-video-wrap">
      <video
        src="/videos/hero-demo.mp4"
        autoplay
        loop
        muted
        playsinline
        class="hero-video"
      ></video>
    </div>
  </section>

  <section class="features">
    <div class="features-inner">
      <div class="section-label">What's Included</div>
      <h2 class="section-title">Everything You Need</h2>
      <div class="feat-grid">
        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8V4H8M4 8h16M4 8v12h16V8M9 12v4m6-4v4"/></svg>
          <div class="feat-title">DiMase AI Platform</div>
          <div class="feat-desc">Advanced AI assistant with full agent capabilities — code execution, web search, automation, and more.</div>
          <a href="/dimase/call" style="display:inline-block;margin-top:10px;font-size:0.75rem;color:var(--gold);text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-weight:600;">&#128222; Voice Call &rarr;</a>
        </div>
        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          <div class="feat-title">Jellyfin Media Server</div>
          <div class="feat-desc">Stream your personal media library from anywhere. Movies, TV shows, music — all in one place.</div>
        </div>

        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm6 11a6 6 0 0 1-12 0M12 19v4m-4 0h8"/></svg>
          <div class="feat-title">DiMase Inc. Podcast</div>
          <div class="feat-desc">Access our full podcast catalog covering tech, innovation, and digital culture. New episodes regularly.</div>
          <a href="https://open.spotify.com/show/1fSOrw2QQaOHY5rrn6MXZ9" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:0.75rem;color:#1DB954;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-weight:600;"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Listen on Spotify</a><a href="/podcast.rss" style="display:inline-block;margin-top:10px;margin-left:12px;font-size:0.75rem;color:var(--gold);text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-weight:600;opacity:0.7;">RSS &rarr;</a>
        </div>
        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <div class="feat-title">Learning Platform</div>
          <div class="feat-desc">Computer basics courses with AI-powered tutoring. Learn at your own pace with guided modules.</div>
        </div>
        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <div class="feat-title">Remote Assistance</div>
          <div class="feat-desc">Get expert remote support directly on your device. Fast, secure, and hassle-free tech help.</div>
        </div>
        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <div class="feat-title">D-Trading Post</div>
          <div class="feat-desc">Western-themed marketplace to buy, sell, and bid on goods. Join the community and trade with fellow partners.</div>
          <a href="https://dtradingpost.dimaseinc.org" style="display:inline-block;margin-top:10px;font-size:0.75rem;color:var(--gold);text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Browse Items &rarr;</a>
        </div>
        <div class="feat-card">
          <svg class="feat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 17v-2a4 4 0 1 0-4-4H6a6 6 0 1 1 12 0v2"/><rect x="3" y="17" width="18" height="5" rx="1"/><circle cx="12" cy="20" r="1"/></svg>
          <div class="feat-title">DiMase Locksmith</div>
          <div class="feat-desc">24/7 locksmith services — car lockouts, home entry, key replacement, and lock installation.</div>
          <a href="https://locksmith.dimaseinc.org" style="display:inline-block;margin-top:10px;font-size:0.75rem;color:var(--gold);text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Request Service &rarr;</a>
        </div>
      </div>
    </div>
  </section>

  <section class="pricing">
    <div class="pricing-inner" style="max-width:1100px;">
      <div class="section-label">Pricing</div>
      <h2 class="section-title">Pick Your Plan</h2>
      <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:40px;">7-day free trial on all plans. Cancel anytime.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:40px;">
        <div style="background:var(--black-card);border:1px solid var(--border);padding:28px 20px;text-align:left;">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:10px;">Site Only</div>
          <div style="font-size:2rem;font-weight:800;color:var(--text);">$7<span style="font-size:0.9rem;font-weight:400;color:var(--text-muted);">/mo</span></div>
          <ul style="list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:8px;font-size:0.8rem;color:var(--text-muted);">
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>DiMase AI (5 req/hr)</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Learning platform + AI tutor</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Podcast + media streaming</li>
          </ul>
        </div>
        <div style="background:var(--black-card);border:1px solid var(--border);padding:28px 20px;text-align:left;">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:10px;">Site + Remote Desktop</div>
          <div style="font-size:2rem;font-weight:800;color:var(--text);">$35<span style="font-size:0.9rem;font-weight:400;color:var(--text-muted);">/mo</span></div>
          <ul style="list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:8px;font-size:0.8rem;color:var(--text-muted);">
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Everything in Site Only</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>2 free RustDesk sessions/mo</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Additional sessions $30/hr</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Session bundle code</li>
          </ul>
        </div>
        <div style="background:var(--black-card);border:1px solid var(--border);padding:28px 20px;text-align:left;">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:10px;">Site + Seller</div>
          <div style="font-size:2rem;font-weight:800;color:var(--text);">$45<span style="font-size:0.9rem;font-weight:400;color:var(--text-muted);">/mo</span></div>
          <ul style="list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:8px;font-size:0.8rem;color:var(--text-muted);">
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Everything in Site Only</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>D-Trading Post seller profile</li>
            <li style="display:flex;gap:8px;"><span style="color:#f59e0b;font-size:0.9em;">ℹ</span><span>15% sales commission retained by DiMase Inc.</span></li>
          </ul>
        </div>
        <div style="background:var(--black-card);border:1px solid var(--border);padding:28px 20px;text-align:left;">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:10px;">RDP + Seller</div>
          <div style="font-size:2rem;font-weight:800;color:var(--text);">$65<span style="font-size:0.9rem;font-weight:400;color:var(--text-muted);">/mo</span></div>
          <ul style="list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:8px;font-size:0.8rem;color:var(--text-muted);">
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Everything in Site Only</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>2 RustDesk sessions/mo + Seller</li>
          </ul>
        </div>
        <div style="background:var(--black-card);border:1px solid var(--gold);padding:28px 20px;text-align:left;position:relative;">
          <div style="position:absolute;top:-1px;right:20px;background:var(--gold);color:#000;font-size:0.6rem;font-weight:800;letter-spacing:2px;padding:3px 10px;">BEST VALUE</div>
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);margin-bottom:10px;">Full Bundle</div>
          <div style="font-size:2rem;font-weight:800;color:var(--gold);">$75<span style="font-size:0.9rem;font-weight:400;color:var(--text-muted);">/mo</span></div>
          <ul style="list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:8px;font-size:0.8rem;color:var(--text-muted);">
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Everything included</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>5 free locksmith callouts/mo</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>2 RustDesk sessions/mo</li>
            <li style="display:flex;gap:8px;"><span style="color:var(--gold);">✓</span>Seller profile included</li>
          </ul>
        </div>
      </div>
      <a class="btn-primary" href="/register" style="display:inline-block;padding:14px 48px;">Start 7-Day Free Trial</a>
    </div>
  </section>

  <footer>
    &copy; ${new Date().getFullYear()} DiMase Inc. &nbsp;|&nbsp;
    <a href="/podcast.rss">RSS Feed</a> &nbsp;|&nbsp;
     &nbsp;|&nbsp;
    <a href="/login">Log In</a>
  </footer>
</body>
</html>`;
}

function memberDashboardHTML(user) {
  const plan = user.subscription_plan || (user.is_admin ? 'admin' : null);
  const status = user.subscription_status || 'trial';
  const isTrial = status === 'trial';
  const isAdmin = !!user.is_admin;

  // Plan display name + color
  const PLAN_LABELS = {
    site: { label: 'Site Only', color: '#22c55e' },
    rdp: { label: 'Site + RDP', color: '#3b82f6' },
    seller: { label: 'Site + Seller', color: '#f59e0b' },
    rdp_seller: { label: 'RDP + Seller', color: '#8b5cf6' },
    bundle: { label: 'Full Bundle', color: '#d4af37' },
    admin: { label: 'Administrator', color: '#ef4444' }
  };
  const planInfo = isAdmin ? PLAN_LABELS.admin : (PLAN_LABELS[plan] || { label: isTrial ? '7-Day Trial' : 'Subscriber', color: '#6b7280' });

  // Feature access
  const hasRdp = isAdmin || ['rdp','rdp_seller','bundle'].includes(plan);
  const hasSeller = isAdmin || ['seller','rdp_seller','bundle'].includes(plan);
  const hasLocksmith = isAdmin || plan === 'bundle';
  const hasAll = hasRdp && hasSeller && hasLocksmith;

  // Trial days remaining
  let trialDays = 0;
  if (isTrial && user.trial_end) {
    const end = new Date(user.trial_end.endsWith('Z') ? user.trial_end : user.trial_end + 'Z');
    trialDays = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  }

  const featureCard = (icon, title, desc, href, unlocked, upgradeText) => {
    if (unlocked || isTrial) {
      const previewBadge = (!unlocked && isTrial) ? `<span style="position:absolute;top:8px;right:8px;background:#1d4ed8;color:#fff;font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:0.5px">TRIAL PREVIEW</span>` : '';
      return `<a href="${href}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''} style="display:block;text-decoration:none;background:#111;border:1px solid ${unlocked ? '#333' : '#1d4ed8'};border-radius:8px;padding:20px;position:relative;transition:border-color 0.2s;cursor:pointer" onmouseover="this.style.borderColor='#d4af37'" onmouseout="this.style.borderColor='${unlocked ? '#333' : '#1d4ed8'}'">
        ${previewBadge}
        <div style="font-size:2rem;margin-bottom:10px">${icon}</div>
        <div style="color:#fff;font-weight:700;font-size:0.95rem;margin-bottom:4px">${title}</div>
        <div style="color:#666;font-size:0.8rem;margin-bottom:12px">${desc}</div>
        <span style="color:#d4af37;font-size:0.8rem;font-weight:600">Launch &rarr;</span>
      </a>`;
    }
    return `<div style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:8px;padding:20px;position:relative;opacity:0.55;cursor:default">
      <div style="position:absolute;top:8px;right:8px;background:#1a1a1a;color:#666;font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:0.5px">LOCKED</div>
      <div style="font-size:2rem;margin-bottom:10px;filter:grayscale(1)">${icon}</div>
      <div style="color:#444;font-weight:700;font-size:0.95rem;margin-bottom:4px">${title}</div>
      <div style="color:#333;font-size:0.8rem;margin-bottom:12px">${desc}</div>
      <a href="/subscribe" style="color:#d4af37;font-size:0.8rem;font-weight:600;text-decoration:none">${upgradeText || 'Upgrade to unlock &rarr;'}</a>
    </div>`;
  };

  const adminCard = (icon, title, desc, href) => `
    <a href="${href}" target="_blank" rel="noopener" style="display:block;text-decoration:none;background:#1a0a00;border:1px solid #d4af37;border-radius:8px;padding:20px;transition:background 0.2s" onmouseover="this.style.background='#2a1500'" onmouseout="this.style.background='#1a0a00'">
      <div style="font-size:2rem;margin-bottom:10px">${icon}</div>
      <div style="color:#d4af37;font-weight:700;font-size:0.95rem;margin-bottom:4px">${title}</div>
      <div style="color:#999;font-size:0.8rem;margin-bottom:12px">${desc}</div>
      <span style="color:#d4af37;font-size:0.8rem;font-weight:600">Open &rarr;</span>
    </a>`;

  const trialBanner = isTrial ? `
  <div style="background:${trialDays <= 2 ? '#7f1d1d' : '#1e3a5f'};border:1px solid ${trialDays <= 2 ? '#ef4444' : '#3b82f6'};border-radius:8px;padding:14px 20px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div>
      <span style="color:${trialDays <= 2 ? '#fca5a5' : '#93c5fd'};font-weight:700;font-size:0.95rem">
        ${trialDays > 0 ? `&#9200; Trial expires in ${trialDays} day${trialDays !== 1 ? 's' : ''}` : '&#9888; Trial expired — subscribe to keep access'}
      </span>
      <div style="color:#999;font-size:0.8rem;margin-top:2px">You're enjoying a full preview of all features</div>
    </div>
    <a href="/subscribe" style="background:#d4af37;color:#000;font-weight:700;padding:8px 20px;border-radius:4px;text-decoration:none;font-size:0.85rem;white-space:nowrap">Subscribe Now &rarr;</a>
  </div>` : '';

  const adminSection = isAdmin ? `
  <div style="margin-top:32px">
    <div style="color:#d4af37;font-size:0.7rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px;border-bottom:1px solid #1a1a1a;padding-bottom:8px">&#9888; Admin Control</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
      ${adminCard('🏠', 'DiMaseHome', 'Ecosystem control panel', 'https://home.dimaseinc.org')}
      ${adminCard('💻', 'Terminal', 'Secure system shell access', '/terminal')}
      ${adminCard('📚', 'Learning Admin', 'Manage LMS classes & users', '/member#' )}
      ${adminCard('🛒', 'D-Trading Admin', 'Market & order management', 'https://dtradingpost.dimaseinc.org/admin')}
      ${adminCard('🔐', 'Locksmith Admin', 'Service request dashboard', 'https://locksmith.dimaseinc.org/admin')}
      ${adminCard('📊', 'Grafana', 'Server metrics & logs', 'https://neo-grafana.dimaseinc.org')}
    </div>
  </div>` : '';

  const upgradeSection = (!isAdmin && !hasAll) ? `
  <div style="margin-top:32px;background:#0d0d0d;border:1px solid #1a1a1a;border-radius:8px;padding:24px">
    <div style="color:#d4af37;font-weight:700;margin-bottom:8px">&#11014; Upgrade Your Plan</div>
    <div style="color:#666;font-size:0.85rem;margin-bottom:16px">Unlock more features by upgrading your subscription</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${!hasRdp ? '<a href="/subscribe" style="background:#1d4ed8;color:#fff;padding:8px 18px;border-radius:4px;text-decoration:none;font-size:0.85rem;font-weight:600">+ RDP Access ($35/mo)</a>' : ''}
      ${!hasSeller ? '<a href="/subscribe" style="background:#f59e0b;color:#000;padding:8px 18px;border-radius:4px;text-decoration:none;font-size:0.85rem;font-weight:600">+ Seller Account ($45/mo)</a>' : ''}
      ${!hasLocksmith ? '<a href="/subscribe" style="background:#d4af37;color:#000;padding:8px 18px;border-radius:4px;text-decoration:none;font-size:0.85rem;font-weight:600">Full Bundle - Everything ($75/mo)</a>' : ''}
    </div>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My Dashboard &mdash; DiMase Inc.</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0a;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
    .header{background:#111;border-bottom:1px solid #1a1a1a;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
    .logo{display:flex;align-items:center;gap:10px;text-decoration:none}
    .logo-text{color:#d4af37;font-weight:800;font-size:1.1rem;letter-spacing:1px}
    .logo-sub{color:#555;font-size:0.75rem;margin-left:4px}
    .header-right{display:flex;align-items:center;gap:12px}
    .plan-badge{padding:4px 12px;border-radius:20px;font-size:0.72rem;font-weight:700;letter-spacing:0.5px;background:${planInfo.color}22;color:${planInfo.color};border:1px solid ${planInfo.color}55}
    .btn-logout{background:transparent;border:1px solid #333;color:#999;padding:6px 14px;border-radius:4px;font-size:0.8rem;cursor:pointer;text-decoration:none}
    .btn-logout:hover{border-color:#ef4444;color:#ef4444}
    .main{max-width:1100px;margin:0 auto;padding:32px 24px}
    .welcome{margin-bottom:28px}
    .welcome h1{font-size:1.5rem;color:#fff;font-weight:700;margin-bottom:4px}
    .welcome p{color:#666;font-size:0.9rem}
    .section-label{color:#555;font-size:0.7rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px;border-bottom:1px solid #1a1a1a;padding-bottom:8px}
    .features-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
    footer{text-align:center;padding:32px 24px;color:#333;font-size:0.8rem;border-top:1px solid #111;margin-top:48px}
    footer a{color:#555;text-decoration:none}
    footer a:hover{color:#d4af37}
  </style>
</head>
<body>
<header class="header">
  <a href="/" class="logo">
    <span style="font-size:1.3rem">&#9670;</span>
    <span class="logo-text">DIMASE INC.</span>
  </a>
  <div class="header-right">
    <span class="plan-badge">${planInfo.label.toUpperCase()}</span>
    <span style="color:#555;font-size:0.85rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.display_name || user.email}</span>
    <form method="POST" action="/site-logout" style="margin:0"><button type="submit" class="btn-logout">Sign Out</button></form>
  </div>
</header>
<main class="main">
  <div class="welcome">
    <h1>Welcome back, ${user.display_name || 'Member'} &#128075;</h1>
    <p>${isAdmin ? 'You have full admin access to all DiMase Inc. services.' : isTrial ? `You're on a ${trialDays}-day trial — explore everything DiMase Inc. has to offer.` : `Your ${planInfo.label} plan is active. Here's everything available to you.`}</p>
  </div>

  ${trialBanner}

  <div class="section-label">Your Features</div>
  <div class="features-grid">
    ${featureCard('🤖', 'DiMase AI', 'Intelligent AI assistant powered by Claude & LLaMA', '/dimase/chat-ui', true)}
    ${featureCard('📚', 'DiMase Learning', 'AI & tech courses — DiMase AI + Chatbot Builder tracks', '/learning.html', true)}
    ${featureCard('⌨️', 'Typing Mastery', '30 touch typing lessons — track WPM & accuracy', '/typing.html', true)}
    ${featureCard('📖', 'Reading Mastery', '30 lessons across 3 levels — build comprehension & speed', '/reading.html', true)}
    ${featureCard('🎙️', 'Podcast', 'DiMase Inc. podcast — episodes & RSS feed', '/podcast', true)}
    ${featureCard('📺', 'Streaming', 'Jellyfin media library — movies, shows, music', 'https://jellyfin.dimaseinc.org', true)}
    ${featureCard('💻', 'Remote Desktop', 'RustDesk RDP sessions — 2 free/mo included', '/remote', hasRdp, 'Upgrade to Site + RDP ($35/mo)')}
    ${featureCard('🛒', 'D-Trading Seller', 'List items on the D-Trading Post marketplace', 'https://dtradingpost.dimaseinc.org/sell', hasSeller, 'Upgrade to Site + Seller ($45/mo)')}
    ${featureCard('🔐', 'Locksmith Service', '5 free locksmith callouts/month included', 'https://locksmith.dimaseinc.org', hasLocksmith, 'Upgrade to Full Bundle ($75/mo)')}
    ${featureCard('⚡', 'DiMase Deploy', 'Plug in & deploy AI diagnostics to any device', '/dimase-deploy/', true)}
    ${featureCard('📦', 'Applications', 'Download DiMase Inc. apps — Linux, Windows, Android', '/applications.html', true)}
  </div>

  ${adminSection}
  ${upgradeSection}

  <div style="margin-top:32px;background:#111;border:1px solid #1a1a1a;border-radius:8px;padding:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div>
      <div style="color:#fff;font-weight:600;font-size:0.9rem">Manage Your Subscription</div>
      <div style="color:#555;font-size:0.8rem;margin-top:2px">Update plan, billing, or cancel anytime</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a href="/subscribe" style="color:#d4af37;border:1px solid #d4af3755;padding:7px 16px;border-radius:4px;text-decoration:none;font-size:0.82rem;font-weight:600">Upgrade Plan</a>
      <a href="/support" style="color:#999;border:1px solid #333;padding:7px 16px;border-radius:4px;text-decoration:none;font-size:0.82rem">Support</a>
    </div>
  </div>
</main>
<footer>
  <p>DiMase Inc. &mdash; <a href="/">Home</a> &middot; <a href="/support">Support</a> &middot; <a href="/site-logout">Sign Out</a></p>
</footer>
</body>
</html>`;
}

function siteLoginPageHTML(error = '', redirect = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Log In | DiMase Inc.</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --gold: #d4af37; --black: #0a0a0a; --black-card: #141414; --text: #fff; --text-muted: #888; --border: #2a2a2a; --red: #ef4444; }
    body { font-family: 'Inter', sans-serif; background: var(--black); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
    .logo { font-size: 0.85rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); text-decoration: none; display: block; text-align: center; margin-bottom: 48px; }
    .card { background: var(--black-card); border: 1px solid var(--border); padding: 40px 36px; width: 100%; max-width: 400px; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 8px; }
    .sub { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 32px; }
    label { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 6px; }
    input { width: 100%; background: var(--black); border: 1px solid var(--border); color: var(--text); padding: 11px 14px; font-family: inherit; font-size: 0.9rem; outline: none; margin-bottom: 20px; }
    input:focus { border-color: var(--gold); }
    .error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--red); padding: 10px 14px; font-size: 0.83rem; margin-bottom: 20px; }
    .btn { width: 100%; background: var(--gold); color: #000; border: none; padding: 13px; font-family: inherit; font-size: 0.88rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.88; }
    .links { margin-top: 24px; display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); }
    .links a { color: var(--gold); text-decoration: none; }
    .links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a class="logo" href="/">DiMase Inc.</a>
  <div class="card">
    <h1>Welcome Back</h1>
    <p class="sub">Sign in to your DiMase Inc. account</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/login${redirect ? '?r=' + encodeURIComponent(redirect) : '' }">
      <label>Email Address</label>
      <input type="email" name="email" autocomplete="email" required placeholder="you@example.com">
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required placeholder="••••••••">
      <button class="btn" type="submit">Log In</button>
    </form>
    <div class="links">
      <span>No account? <a href="/register">Start free trial</a></span>
    </div>
    <div style="margin-top:20px;padding-top:20px;border-top:1px solid var(--border);text-align:center;">
      <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Also from DiMase Inc.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <a href="https://dtradingpost.dimaseinc.org" style="display:inline-block;background:transparent;border:1px solid var(--gold);color:var(--gold);padding:9px 20px;font-family:inherit;font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">&#11088; D-Trading Post &rarr;</a>
        <a href="https://locksmith.dimaseinc.org" style="display:inline-block;background:transparent;border:1px solid var(--gold);color:var(--gold);padding:9px 20px;font-family:inherit;font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">&#128273; DiMase Locksmith &rarr;</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function siteRegisterPageHTML(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create Account | DiMase Inc.</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --gold: #d4af37; --black: #0a0a0a; --black-card: #141414; --text: #fff; --text-muted: #888; --border: #2a2a2a; --red: #ef4444; }
    body { font-family: 'Inter', sans-serif; background: var(--black); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
    .logo { font-size: 0.85rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); text-decoration: none; display: block; text-align: center; margin-bottom: 48px; }
    .card { background: var(--black-card); border: 1px solid var(--border); padding: 40px 36px; width: 100%; max-width: 420px; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 8px; }
    .sub { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px; }
    .trial-note { font-size: 0.78rem; color: var(--gold); margin-bottom: 28px; }
    label { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 6px; }
    input { width: 100%; background: var(--black); border: 1px solid var(--border); color: var(--text); padding: 11px 14px; font-family: inherit; font-size: 0.9rem; outline: none; margin-bottom: 20px; }
    input:focus { border-color: var(--gold); }
    .error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--red); padding: 10px 14px; font-size: 0.83rem; margin-bottom: 20px; }
    .btn { width: 100%; background: var(--gold); color: #000; border: none; padding: 13px; font-family: inherit; font-size: 0.88rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.88; }
    .terms { font-size: 0.75rem; color: var(--text-muted); margin-top: 16px; text-align: center; line-height: 1.6; }
    .links { margin-top: 24px; text-align: center; font-size: 0.8rem; color: var(--text-muted); }
    .links a { color: var(--gold); text-decoration: none; }
    .links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a class="logo" href="/">DiMase Inc.</a>
  <div class="card">
    <h1>Create Account</h1>
    <p class="sub">Get full access to the DiMase Inc. platform</p>
    <p class="trial-note">7-day free trial — then from $7/month</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/register">
      <label>Email Address</label>
      <input type="email" name="email" autocomplete="email" required placeholder="you@example.com">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" required placeholder="Your display name" minlength="2" maxlength="32">
      <label>Password</label>
      <input type="password" name="password" autocomplete="new-password" required placeholder="At least 6 characters" minlength="6">
      <label>Confirm Password</label>
      <input type="password" name="confirm" autocomplete="new-password" required placeholder="Re-enter your password">
      <button class="btn" type="submit">Create Account &amp; Start Trial</button>
    </form>
    <p class="terms">By registering you agree to our terms. Your account also grants access to Jellyfin media streaming.</p>
    <div class="links">Already have an account? <a href="/login">Log In</a></div>
  </div>
</body>
</html>`;
}

function subscribePageHTML(user, clientId, sitePlanId, rdpPlanId, sellerPlanId, rdpSellerPlanId, bundlePlanId) {
  const statusMap = { trial:'Trial', active:'Active', grandfathered:'Grandfathered', expired:'Expired', revoked:'Revoked' };
  const status = user.subscription_status || 'trial';
  const isActive = status === 'active' || status === 'grandfathered';
  const trialEnd = user.trial_end ? new Date(user.trial_end.endsWith('Z') ? user.trial_end : user.trial_end + 'Z').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : null;

  const PLANS = [
    {
      id: 'site', planId: sitePlanId, price: '$7', period: '/mo',
      name: 'Site Only',
      desc: 'Everything digital — no limits on learning.',
      features: ['DiMase Learning Platform (full access)', 'Podcast — all episodes', 'DiMase AI (5 requests / hour)', 'Community access'],
      badge: null
    },
    {
      id: 'rdp', planId: rdpPlanId, price: '$35', period: '/mo',
      name: 'Site + Remote Desktop',
      desc: 'Remote support sessions included.',
      features: ['Everything in Site Only', '2 free RustDesk sessions / month', 'Additional sessions at $30/hr', 'Priority response'],
      badge: 'POPULAR'
    },
    {
      id: 'seller', planId: sellerPlanId, price: '$45', period: '/mo',
      name: 'Site + TP Seller',
      desc: 'Sell on D-Trading Post with your monthly fee included.',
      features: ['Everything in Site Only', 'D-Trading Post seller profile', 'DiMase Inc. retains 15% commission on all sales', 'Unlimited active listings'],
      badge: null
    },
    {
      id: 'rdp_seller', planId: rdpSellerPlanId, price: '$65', period: '/mo',
      name: 'Site + RDP + Seller',
      desc: 'The power combo — support plus marketplace.',
      features: ['Everything in Site Only', '2 free RustDesk sessions / month', 'D-Trading Post seller profile', 'DiMase Inc. retains 15% commission on all sales'],
      badge: null
    },
    {
      id: 'bundle', planId: bundlePlanId, price: '$75', period: '/mo',
      name: 'Full Bundle',
      desc: 'The whole ecosystem at a killer rate.',
      features: ['Everything in Site + RDP + Seller', '5 free locksmith callouts / month*', 'All current + future services', 'Priority support across all platforms'],
      badge: 'BEST VALUE',
      note: '* Service/dispatch fee still applies. Job fee waived.'
    }
  ];

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--black:#080810;--card:#0f0f1a;--border:#1e1e35;--gold:#c9a227;--gold2:#d4af37;--text:#e8e8f0;--muted:#888;--green:#22c55e;--blue:#3b82f6}
    body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:var(--black);color:var(--text);min-height:100vh;padding:0 0 60px}
    a{color:var(--gold);text-decoration:none}
    .wrap{max-width:1100px;margin:0 auto;padding:0 20px}
    nav{background:#09091a;border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
    .nav-brand{font-size:1rem;font-weight:800;letter-spacing:2px;color:var(--gold);text-transform:uppercase}
    .nav-back{font-size:.82rem;color:var(--muted)}
    .hero{text-align:center;padding:60px 20px 40px}
    .hero h1{font-size:2.2rem;font-weight:800;margin-bottom:12px}
    .hero h1 span{color:var(--gold)}
    .hero-sub{color:var(--muted);font-size:1rem;max-width:500px;margin:0 auto}
    .plans-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:40px auto;max-width:1100px;padding:0 20px}
    .plan-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px 20px;display:flex;flex-direction:column;gap:14px;position:relative;transition:border-color .2s}
    .plan-card:hover{border-color:var(--gold)}
    .plan-card.featured{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}
    .plan-badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--gold);color:#000;font-size:.68rem;font-weight:800;letter-spacing:1.5px;padding:3px 12px;border-radius:20px;white-space:nowrap;text-transform:uppercase}
    .plan-name{font-size:1rem;font-weight:700;color:var(--text)}
    .plan-price{font-size:2.2rem;font-weight:800;color:var(--gold);line-height:1}
    .plan-price span{font-size:1rem;color:var(--muted);font-weight:400}
    .plan-desc{font-size:.82rem;color:var(--muted);line-height:1.5}
    .plan-features{list-style:none;display:flex;flex-direction:column;gap:6px;flex:1}
    .plan-features li{font-size:.8rem;color:var(--text);display:flex;align-items:flex-start;gap:7px}
    .plan-features li::before{content:'✓';color:var(--green);font-weight:700;flex-shrink:0;margin-top:1px}
    .plan-note{font-size:.72rem;color:#555;font-style:italic}
    .plan-btn{width:100%;padding:11px;border-radius:5px;font-size:.88rem;font-weight:700;cursor:pointer;letter-spacing:.5px;text-align:center;transition:opacity .2s;border:none;margin-top:auto}
    .plan-btn:hover{opacity:.88}
    .plan-btn-active{background:var(--gold);color:#000}
    .plan-btn-disabled{background:#1a1a2e;color:#444;cursor:default}
    .paypal-wrap{min-height:48px;margin-top:8px}
    .already-active{max-width:600px;margin:0 auto 30px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:20px;text-align:center}
    .note-bar{text-align:center;color:var(--muted);font-size:.8rem;margin-top:30px;padding:0 20px}
    @media(max-width:768px){.plans-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:480px){.plans-grid{grid-template-columns:1fr}}
  `;

  const planCards = PLANS.map(p => {
    const hasPaypal = !!(clientId && p.planId);
    const btnHtml = isActive
      ? `<div class="plan-btn plan-btn-disabled">Current Plan Area ✓</div>`
      : hasPaypal
        ? `<div class="paypal-wrap" id="paypal-${p.id}"><button class="plan-btn plan-btn-active" onclick="selectAndRender('${p.id}','${p.planId}')">Subscribe ${p.price}/mo →</button></div>`
        : `<div class="plan-btn plan-btn-disabled">Coming Soon</div>`;
    return `
    <div class="plan-card${p.badge === 'BEST VALUE' ? ' featured' : ''}">
      ${p.badge ? `<div class="plan-badge">${p.badge}</div>` : ''}
      <div class="plan-name">${p.name}</div>
      <div class="plan-price">${p.price}<span>${p.period}</span></div>
      <div class="plan-desc">${p.desc}</div>
      <ul class="plan-features">${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
      ${p.note ? `<div class="plan-note">${p.note}</div>` : ''}
      ${btnHtml}
    </div>`;
  }).join('');

  const alreadyActiveHtml = isActive ? `
    <div class="already-active">
      <div style="font-size:2rem;margin-bottom:8px">✅</div>
      <div style="font-weight:700;color:var(--green);font-size:1.1rem;margin-bottom:6px">You're subscribed!</div>
      <div style="color:var(--muted);font-size:.88rem">Status: <strong style="color:#fff">${statusMap[status] || status}</strong>.
      Thanks for supporting DiMase Inc. &nbsp;<a href="/">← Back to home</a></div>
    </div>` : (trialEnd ? `<p style="text-align:center;color:var(--muted);font-size:.85rem;margin-bottom:20px">Trial active · expires <strong style="color:#fff">${trialEnd}</strong></p>` : '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subscribe — DiMase Inc.</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<nav>
  <a class="nav-brand" href="/">DiMase Inc.</a>
  <a class="nav-back" href="/">← Back</a>
</nav>
<div class="hero">
  <h1>Choose Your <span>Plan</span></h1>
  <p class="hero-sub">Every tier includes the core DiMase platform. Upgrade anytime.</p>
</div>
${alreadyActiveHtml}
<div class="plans-grid">${planCards}</div>
<div id="paypal-section" style="display:none;max-width:460px;margin:0 auto;padding:0 20px">
  <div id="paypal-btn-container" style="min-height:48px"></div>
</div>
<div class="note-bar">
  Subscriptions are billed monthly via PayPal and can be cancelled anytime.
  &nbsp;|&nbsp; <a href="/support">Need help?</a>
  &nbsp;|&nbsp; <a href="/remote">Redeem RustDesk session code</a>
</div>
<script src="https://www.paypal.com/sdk/js?client-id=${clientId || ''}&vault=true&intent=subscription" data-sdk-integration-source="button-factory"></script>
<script>
function selectAndRender(planName, planId) {
  if (!planId) { alert('Plan not configured. Contact support.'); return; }
  var section = document.getElementById('paypal-section');
  var container = document.getElementById('paypal-btn-container');
  section.style.display = 'block';
  container.innerHTML = '<p style="color:#888;font-size:.85rem;text-align:center;padding:8px">Loading payment button...</p>';
  section.scrollIntoView({behavior:'smooth', block:'center'});
  try {
    paypal.Buttons({
      style: { shape:'rect', color:'gold', layout:'vertical', label:'subscribe' },
      createSubscription: function(data, actions) {
        return actions.subscription.create({ plan_id: planId });
      },
      onApprove: function(data, actions) {
        container.innerHTML = '<p style="color:#22c55e;text-align:center;padding:16px;font-weight:700">✓ Activating...</p>';
        fetch('/subscribe/activate', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({subscriptionId: data.subscriptionID})
        }).then(r => r.json()).then(d => {
          if (d.success) {
            container.innerHTML = '<p style="color:#22c55e;text-align:center;font-weight:700;padding:20px">🎉 Subscribed! Redirecting...</p>';
            setTimeout(() => location.href = '/', 1500);
          } else {
            container.innerHTML = '<p style="color:#ef4444;text-align:center;padding:16px">Error: ' + (d.error || 'Unknown') + '</p>';
          }
        }).catch(() => {
          container.innerHTML = '<p style="color:#ef4444;text-align:center;padding:16px">Network error. Contact support.</p>';
        });
      },
      onError: function(err) {
        container.innerHTML = '<p style="color:#ef4444;text-align:center;padding:12px;font-size:.85rem">PayPal error. Try again or contact support.</p>';
      }
    }).render('#paypal-btn-container');
  } catch(e) {
    container.innerHTML = '<p style="color:#888;font-size:.85rem;text-align:center;padding:16px">Payment system is being configured. Check back shortly.</p>';
  }
}
</script>
</body>
</html>`;
}

function supportPageHTML(user) {
  const prefillEmail = (user && user.email) ? user.email : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Remote Technical Assistance | DiMase Inc.</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --gold: #d4af37; --gold-light: #f4d03f; --black: #0a0a0a; --black-card: #141414; --text: #fff; --text-muted: #888; --border: #2a2a2a; --green: #22c55e; }
    body { font-family: 'Inter', sans-serif; background: var(--black); color: var(--text); min-height: 100vh; padding: 24px; }
    a { color: var(--gold); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .top-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 56px; }
    .logo { font-size: 0.85rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); text-decoration: none; }
    .top-bar-links { display: flex; gap: 20px; align-items: center; }
    .top-link { font-size: 0.75rem; color: var(--text-muted); text-decoration: none; text-transform: uppercase; letter-spacing: 1px; transition: color 0.2s; }
    .top-link:hover { color: var(--gold); text-decoration: none; }
    .main { max-width: 720px; margin: 0 auto; }
    .eyebrow { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 3px; color: var(--gold); margin-bottom: 16px; }
    h1 { font-size: 2.2rem; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 16px; line-height: 1.2; }
    .intro { font-size: 1rem; color: var(--text-muted); line-height: 1.7; margin-bottom: 48px; max-width: 580px; }
    /* Pricing */
    .section-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; color: var(--text-muted); margin-bottom: 20px; }
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 12px; }
    .price-box { background: var(--black-card); border: 1px solid var(--border); padding: 24px 20px; }
    .price-box.featured { border-color: var(--gold); }
    .price-name { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); margin-bottom: 10px; }
    .price-amount { font-size: 2rem; font-weight: 800; letter-spacing: -1px; color: var(--text); margin-bottom: 4px; }
    .price-amount span { font-size: 0.85rem; font-weight: 400; color: var(--text-muted); }
    .price-desc { font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; margin-top: 10px; }
    .coupon-note { font-size: 0.78rem; color: var(--gold); background: rgba(212,175,55,0.08); border: 1px solid rgba(212,175,55,0.2); padding: 10px 14px; margin-bottom: 48px; }
    .coupon-note code { background: rgba(212,175,55,0.15); padding: 1px 6px; font-family: monospace; letter-spacing: 0.5px; }
    /* Steps */
    .steps { margin-bottom: 48px; }
    .step { display: flex; gap: 20px; margin-bottom: 24px; align-items: flex-start; }
    .step-num { flex-shrink: 0; width: 32px; height: 32px; background: var(--gold); color: #000; font-weight: 800; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; }
    .step-content { padding-top: 4px; }
    .step-title { font-size: 0.92rem; font-weight: 600; margin-bottom: 4px; }
    .step-desc { font-size: 0.82rem; color: var(--text-muted); line-height: 1.6; }
    /* Downloads */
    .downloads { margin-bottom: 48px; }
    .dl-grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .dl-btn { display: inline-flex; align-items: center; gap: 8px; background: var(--black-card); border: 1px solid var(--border); color: var(--text); padding: 10px 18px; font-size: 0.82rem; font-weight: 500; text-decoration: none; transition: border-color 0.2s, color 0.2s; }
    .dl-btn:hover { border-color: var(--gold); color: var(--gold); text-decoration: none; }
    .dl-icon { font-size: 1rem; }
    /* Form */
    .form-card { background: var(--black-card); border: 1px solid var(--border); padding: 36px 32px; margin-bottom: 48px; }
    .form-card h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: 24px; }
    label { display: block; font-size: 0.73rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 6px; }
    .form-row { margin-bottom: 20px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    input[type=text], input[type=email], select, textarea { width: 100%; background: var(--black); border: 1px solid var(--border); color: var(--text); padding: 11px 14px; font-family: inherit; font-size: 0.88rem; outline: none; }
    input[type=text]:focus, input[type=email]:focus, select:focus, textarea:focus { border-color: var(--gold); }
    select { appearance: none; cursor: pointer; }
    select option { background: #1a1a1a; }
    textarea { resize: vertical; min-height: 120px; line-height: 1.6; }
    .submit-btn { background: var(--gold); color: #000; border: none; padding: 14px 32px; font-family: inherit; font-size: 0.88rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; cursor: pointer; transition: opacity 0.2s; width: 100%; margin-top: 8px; }
    .submit-btn:hover { opacity: 0.88; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .msg { margin-top: 20px; padding: 14px 18px; font-size: 0.85rem; display: none; }
    .msg.success { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: var(--green); }
    .msg.error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }
    @media (max-width: 560px) {
      h1 { font-size: 1.6rem; }
      .form-grid { grid-template-columns: 1fr; }
      .form-card { padding: 24px 18px; }
      .pricing-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <a class="logo" href="/">DiMase Inc.</a>
    <div class="top-bar-links">
      <a class="top-link" href="/">Home</a>
      ${user ? `<a class="top-link" href="/site-logout">Log Out</a>` : `<a class="top-link" href="/login">Log In</a>`}
    </div>
  </div>
  <div class="main">
    <div class="eyebrow">Technical Support</div>
    <h1>Remote Technical Assistance</h1>
    <p class="intro">Get expert tech help directly on your device via secure remote access. Our technician will connect to your screen and resolve your issue — no complicated setup required.</p>

    <div class="section-label">Pricing Options</div>
    <div class="pricing-grid">
      <div class="price-box">
        <div class="price-name">Site Plan Only</div>
        <div class="price-amount">$5<span>/month</span></div>
        <div class="price-desc">Full access to the DiMase Inc. platform — AI, media, LMS, and podcast. Remote support not included.</div>
      </div>
      <div class="price-box featured">
        <div class="price-name">Full Bundle</div>
        <div class="price-amount">$30<span>/month</span></div>
        <div class="price-desc">Everything in the Site Plan plus unlimited remote technical assistance sessions included.</div>
      </div>
      <div class="price-box">
        <div class="price-name">Pay As You Go</div>
        <div class="price-amount">$16<span>/hr</span></div>
        <div class="price-desc">Remote assistance billed per hour. No subscription required — pay only when you need help.</div>
      </div>
    </div>
    <div class="coupon-note">Use coupon code <code>supernerd</code> for $2 off the first month of any subscription plan.</div>

    <div class="section-label">How It Works</div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <div class="step-title">Download &amp; install RustDesk</div>
          <div class="step-desc">RustDesk is a free, open-source remote desktop tool. Download it for your operating system using the links below.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <div class="step-title">Find your 9-digit RustDesk ID</div>
          <div class="step-desc">Open RustDesk after installation. Your unique ID is displayed prominently on the main screen — it looks like <strong>123 456 789</strong>. Note it down.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <div class="step-title">Submit the form below</div>
          <div class="step-desc">Fill in your details, paste your RustDesk ID, and describe your issue. We'll initiate a connection remotely within minutes.</div>
        </div>
      </div>
    </div>

    <div class="section-label">Download RustDesk</div>
    <div class="downloads">
      <div class="dl-grid">
        <a class="dl-btn" href="https://github.com/rustdesk/rustdesk/releases/latest" target="_blank" rel="noopener">
          <span class="dl-icon">&#x1F5A5;</span> Windows (.exe)
        </a>
        <a class="dl-btn" href="https://github.com/rustdesk/rustdesk/releases/latest" target="_blank" rel="noopener">
          <span class="dl-icon">&#xF8FF;</span> macOS (.dmg)
        </a>
        <a class="dl-btn" href="https://github.com/rustdesk/rustdesk/releases/latest" target="_blank" rel="noopener">
          <span class="dl-icon">&#x1F427;</span> Linux (.deb/.rpm)
        </a>
        <a class="dl-btn" href="https://apps.apple.com/app/id1581225015" target="_blank" rel="noopener">
          <span class="dl-icon">&#x1F4F1;</span> iPhone / iPad
        </a>
        <a class="dl-btn" href="https://play.google.com/store/apps/details?id=com.carriez.flutter_hbb" target="_blank" rel="noopener">
          <span class="dl-icon">&#x1F4F1;</span> Android
        </a>
      </div>
    </div>

    <div class="form-card">
      <h2>Request Remote Assistance</h2>
      <form id="support-form">
        <div class="form-grid">
          <div>
            <label for="name">Full Name</label>
            <input type="text" id="name" name="name" required placeholder="Your name">
          </div>
          <div>
            <label for="email">Email Address</label>
            <input type="email" id="email" name="email" required placeholder="you@example.com" value="${prefillEmail}">
          </div>
        </div>
        <div class="form-row">
          <label for="rustdeskId">RustDesk ID</label>
          <input type="text" id="rustdeskId" name="rustdeskId" required placeholder="e.g. 123 456 789" autocomplete="off">
        </div>
        <div class="form-row">
          <label for="billing">Billing Option</label>
          <select id="billing" name="billing">
            <option value="Pay As You Go - $16/hr">Pay As You Go — $16/hr</option>
            <option value="I have a Bundle subscription">I have a Bundle subscription</option>
            <option value="I need to upgrade">I need to upgrade my plan</option>
          </select>
        </div>
        <div class="form-row">
          <label for="issue">Describe Your Issue</label>
          <textarea id="issue" name="issue" required placeholder="Please describe what you need help with in as much detail as possible..."></textarea>
        </div>
        <button class="submit-btn" type="submit" id="submit-btn">Send Request</button>
        <div class="msg" id="form-msg"></div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById('support-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const msg = document.getElementById('form-msg');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      msg.style.display = 'none';
      const payload = {
        name: document.getElementById('name').value.trim(),
        email: document.getElementById('email').value.trim(),
        rustdeskId: document.getElementById('rustdeskId').value.trim(),
        issue: document.getElementById('issue').value.trim(),
        billing: document.getElementById('billing').value,
      };
      try {
        const r = await fetch('/support/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (d.success) {
          msg.textContent = 'Your request has been sent. We\\'ll connect shortly.';
          msg.className = 'msg success';
          msg.style.display = 'block';
          document.getElementById('support-form').reset();
          ${prefillEmail ? `document.getElementById('email').value = '${prefillEmail}';` : ''}
        } else {
          msg.textContent = 'Error: ' + (d.error || 'Something went wrong. Please try again.');
          msg.className = 'msg error';
          msg.style.display = 'block';
        }
      } catch(err) {
        msg.textContent = 'Network error: ' + err.message;
        msg.className = 'msg error';
        msg.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = 'Send Request';
    });
  </script>
</body>
</html>`;
}
