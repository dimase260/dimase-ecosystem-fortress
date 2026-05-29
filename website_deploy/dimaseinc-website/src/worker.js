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

async function createSessionToken(user) {
  const ts = Date.now();
  const sig = await sha256(`${user}:${ts}:${SESSION_SECRET}`);
  return btoa(JSON.stringify({ user, ts, sig }));
}

async function validateSession(cookie) {
  if (!cookie) return false;
  try {
    const token = JSON.parse(atob(cookie));
    if (Date.now() - token.ts > 3600000) return false;
    const expected = await sha256(`${token.user}:${token.ts}:${SESSION_SECRET}`);
    return token.sig === expected;
  } catch {
    return false;
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

async function createApiToken(userId, email, env) {
  const payload = { userId, email, exp: Date.now() + 7 * 24 * 3600000 };
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
      const token = await createApiToken(userId, email.toLowerCase(), env);
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
      const token = await createApiToken(user.id, user.email, env);
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

  return null;
}

// --- DIMASE AI CHAT HANDLER ---

// Fallback chat using Cloudflare Workers AI when Agent Zero is unavailable
async function handleChatFallback(message, context, env) {
  const systemPrompt = context || 'You are DiMase, a helpful AI assistant by DiMase Inc. You are knowledgeable, friendly, and direct. Answer questions thoroughly and helpfully.';
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
      const agentZeroUrl = 'https://agent-zero.dimaseinc.org';

      // Authenticate with Agent Zero (with timeout)
      let loginRes;
      try {
        const loginController = new AbortController();
        const loginTimeout = setTimeout(() => loginController.abort(), 10000);
        loginRes = await fetch(agentZeroUrl + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'username=DiMase&password=agent0',
          redirect: 'manual',
          signal: loginController.signal,
        });
        clearTimeout(loginTimeout);
      } catch (loginErr) {
        // Agent Zero unreachable -- use fallback
        return handleChatFallback(message, context, env);
      }

      const setCookieHeader = loginRes.headers.get('Set-Cookie') || '';
      const sessionCookieMatch = setCookieHeader.match(/([^;]+)/);
      const sessionCookie = sessionCookieMatch ? sessionCookieMatch[1] : '';
      if (!sessionCookie) {
        // Agent Zero login failed -- use fallback
        return handleChatFallback(message, context, env);
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
        return handleChatFallback(message, context, env);
      }

      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.token || csrfData.csrf_token || '';
      if (!csrfToken) {
        return handleChatFallback(message, context, env);
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
          return handleChatFallback(message, context, env);
        }
        contextId = createData.ctxid || newContextGuid;

        // If context provided, prime the AI with it
        const systemPrompt = context || 'You are DiMase, a helpful AI assistant by DiMase Inc.';
        const combinedMessage = systemPrompt + '\n\n---\nUser message: ' + message;
        const msgRes = await fetch(agentZeroUrl + '/message', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ text: combinedMessage, context: contextId }),
        });
        const msgData = await msgRes.json();
        return corsApiResponse({
          response: msgData.message || msgData.response || msgData.content || '',
          chatId: contextId,
          model: 'agent-zero',
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
      return handleChatFallback(message, context, env);
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
      const token = await createApiToken(userId, email.toLowerCase(), env);
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
      const token = await createApiToken(user.id, user.email, env);
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

  // --- DIMASE CHAT PROXY ---
  if (path === '/lms/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    try {
      const { message, chatId, classContext } = await request.json();
      const agentZeroUrl = 'https://agent-zero.dimaseinc.org';

      // Authenticate and get CSRF in parallel
      const loginRes = await fetch(agentZeroUrl + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=DiMase&password=agent0',
        redirect: 'manual',
      });
      const setCookieHeader = loginRes.headers.get('Set-Cookie') || '';
      const sessionCookieMatch = setCookieHeader.match(/([^;]+)/);
      const sessionCookie = sessionCookieMatch ? sessionCookieMatch[1] : '';
      if (!sessionCookie) {
        return apiResponse({ error: 'Failed to authenticate with AI tutor service' }, 502);
      }

      // Get CSRF token (Flask updates session cookie when csrf_token is added)
      const csrfRes = await fetch(agentZeroUrl + '/csrf_token', {
        method: 'GET',
        headers: { 'Cookie': sessionCookie },
      });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.token || csrfData.csrf_token || '';
      if (!csrfToken) {
        return apiResponse({ error: 'Failed to obtain CSRF token from AI tutor service' }, 502);
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

      // If no existing chat, create context and prime with system prompt concurrently
      if (!contextId) {
        const newContextGuid = crypto.randomUUID();
        const createRes = await fetch(agentZeroUrl + '/chat_create', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ current_context: '', new_context: newContextGuid }),
        });
        const createData = await createRes.json();
        if (!createData.ok) {
          return apiResponse({ error: 'Failed to create chat session', details: JSON.stringify(createData) }, 502);
        }
        contextId = createData.ctxid || newContextGuid;

        // Prime the AI tutor with class context, then send user message — combine into one prompt
        const systemPrompt = classContext || 'You are a helpful AI tutor.';
        const combinedMessage = systemPrompt + '\n\n---\nStudent question: ' + message;
        const msgRes = await fetch(agentZeroUrl + '/message', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ text: combinedMessage, context: contextId }),
        });
        const msgData = await msgRes.json();
        return apiResponse({
          response: msgData.message || msgData.response || msgData.content || '',
          chatId: contextId,
        });
      }

      // Existing chat — just send the message directly
      const msgRes = await fetch(agentZeroUrl + '/message', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: message, context: contextId }),
      });
      const msgData = await msgRes.json();

      return apiResponse({
        response: msgData.message || msgData.response || msgData.content || '',
        chatId: contextId,
      });
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
      const token = await createApiToken(userId, email.toLowerCase(), env);
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
      const token = await createApiToken(user.id, user.email, env);
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

  // --- DIMASE CHAT PROXY ---
  if (path === '/cb/chat/message' && method === 'POST') {
    const payload = await verifyApiToken(request.headers.get('Authorization'), env);
    if (!payload) return apiResponse({ error: 'Unauthorized' }, 401);
    try {
      const { message, chatId, classContext } = await request.json();
      const agentZeroUrl = 'https://agent-zero.dimaseinc.org';

      // Authenticate and get CSRF in parallel
      const loginRes = await fetch(agentZeroUrl + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=DiMase&password=agent0',
        redirect: 'manual',
      });
      const setCookieHeader = loginRes.headers.get('Set-Cookie') || '';
      const sessionCookieMatch = setCookieHeader.match(/([^;]+)/);
      const sessionCookie = sessionCookieMatch ? sessionCookieMatch[1] : '';
      if (!sessionCookie) {
        return apiResponse({ error: 'Failed to authenticate with AI tutor service' }, 502);
      }

      // Get CSRF token (Flask updates session cookie when csrf_token is added)
      const csrfRes = await fetch(agentZeroUrl + '/csrf_token', {
        method: 'GET',
        headers: { 'Cookie': sessionCookie },
      });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.token || csrfData.csrf_token || '';
      if (!csrfToken) {
        return apiResponse({ error: 'Failed to obtain CSRF token from AI tutor service' }, 502);
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

      // If no existing chat, create context and prime with system prompt concurrently
      if (!contextId) {
        const newContextGuid = crypto.randomUUID();
        const createRes = await fetch(agentZeroUrl + '/chat_create', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ current_context: '', new_context: newContextGuid }),
        });
        const createData = await createRes.json();
        if (!createData.ok) {
          return apiResponse({ error: 'Failed to create chat session', details: JSON.stringify(createData) }, 502);
        }
        contextId = createData.ctxid || newContextGuid;

        // Prime the AI tutor with class context, then send user message — combine into one prompt
        const systemPrompt = classContext || 'You are a helpful AI tutor.';
        const combinedMessage = systemPrompt + '\n\n---\nStudent question: ' + message;
        const msgRes = await fetch(agentZeroUrl + '/message', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ text: combinedMessage, context: contextId }),
        });
        const msgData = await msgRes.json();
        return apiResponse({
          response: msgData.message || msgData.response || msgData.content || '',
          chatId: contextId,
        });
      }

      // Existing chat — just send the message directly
      const msgRes = await fetch(agentZeroUrl + '/message', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ text: message, context: contextId }),
      });
      const msgData = await msgRes.json();

      return apiResponse({
        response: msgData.message || msgData.response || msgData.content || '',
        chatId: contextId,
      });
    } catch (e) {
      return apiResponse({ error: 'Chat service unavailable', details: e.message }, 502);
    }
  }

  return null; // Not a CB API route
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Protected gates: /terminal and /ai
    const gates = {
      '/terminal': { redirect: 'https://terminal.dimaseinc.org', cookie: 'terminal_session', title: 'Terminal Access', icon: 'terminal' },
      '/ai':       { redirect: null, cookie: 'ai_session', title: 'AI Access', icon: 'ai', embed: 'https://agent-zero.dimaseinc.org' },
    };

    // Normalize trailing slash
    const basePath = url.pathname.replace(/\/$/, '') || url.pathname;

    // Route aliases: /learning/computer-basics -> /computer-basics
    const routeAliases = {
      '/learning/computer-basics': '/computer-basics',
    };
    if (routeAliases[basePath]) {
      const newUrl = new URL(request.url);
      newUrl.pathname = routeAliases[basePath];
      return env.ASSETS.fetch(new Request(newUrl, request));
    }

    const gate = gates[basePath];

    if (gate) {
      const session = getCookie(request, gate.cookie);
      if (await validateSession(session)) {
        if (gate.embed) {
          const { 'X-Frame-Options': _, ...embedHeaders } = SECURITY_HEADERS;
          return new Response(embedPageHTML(gate.title, gate.embed, basePath), {
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
          const token = await createSessionToken(username);
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

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/cb/')) {
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

    // Everything else: serve static assets
    return env.ASSETS.fetch(request);
  },
};

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

function embedPageHTML(title, embedUrl, basePath) {
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
  <iframe src="${embedUrl}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}
