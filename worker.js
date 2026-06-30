/**
 * Ideolux Rendered Content Smoke Test — single Cloudflare Worker version.
 *
 * This file is intentionally self-contained:
 * - it serves the HTML UI from `/`
 * - it handles `/api/*` routes in the same Worker
 * - it does NOT require Pages Functions, `_worker.js`, env.ASSETS, wrangler.toml, build step, or npm
 *
 * Paste this whole file into Cloudflare Worker editor and deploy.
 */

const DEFAULT_WP_BASE = 'https://ideolux.it';
const DEFAULT_OPUS_BASE = 'https://ideolux.hm-opus.com';
const SAMPLE_OPUS_DATASHEET_URL = 'https://ideolux.hm-opus.com/document/datasheet/00137ef9-c336-5537-8804-32b37be4e3a2';

const ALLOWED_HOSTS = new Set([
  'ideolux.it',
  'www.ideolux.it',
  'ideolux.hm-opus.com',
  'products.ideolux.it'
]);

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: JSON_HEADERS });
    }

    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return htmlResponse(INDEX_HTML);
      }

      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env || {});
      }

      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: error?.message || String(error),
        stack: env?.DEBUG === 'true' ? error?.stack : undefined
      }, 500);
    }
  }
};

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '');

  if (route === 'health') {
    return jsonResponse({
      ok: true,
      service: 'ideolux-rendered-content-single-worker',
      mode: 'single-worker-no-assets-binding',
      requestedAt: new Date().toISOString(),
      workerHost: url.host,
      routes: [
        '/api/wp/root',
        '/api/wp/frontpage',
        '/api/wp/pages?slug=company',
        '/api/wp/pages?per_page=6',
        '/api/opus/sample-datasheet',
        '/api/opus/discover',
        '/api/opus?url=https://ideolux.hm-opus.com/api/v2/...',
        '/api/document?url=https://ideolux.hm-opus.com/document/datasheet/...'
      ],
      upstreams: {
        wordpress: DEFAULT_WP_BASE,
        opus: DEFAULT_OPUS_BASE,
        sampleDatasheet: SAMPLE_OPUS_DATASHEET_URL
      },
      envConfigured: {
        wpBasicAuth: Boolean(env.WP_USER && env.WP_APP_PASSWORD),
        opusBearer: Boolean(env.OPUS_BEARER_TOKEN),
        opusApiKey: Boolean(env.OPUS_API_KEY),
        opusBasicAuth: Boolean(env.OPUS_BASIC_USER && env.OPUS_BASIC_PASSWORD)
      }
    });
  }

  if (route === 'wp/root') {
    return fetchAndWrap(`${DEFAULT_WP_BASE}/wp-json/`, { env, source: 'wordpress' });
  }

  if (route === 'wp/frontpage') {
    return fetchWordpressFrontPage(env);
  }

  if (route === 'wp/pages') {
    const slug = (url.searchParams.get('slug') || '').trim();
    const search = (url.searchParams.get('search') || '').trim();
    const perPage = sanitizeInt(url.searchParams.get('per_page'), 6, 1, 24);
    const page = sanitizeInt(url.searchParams.get('page'), 1, 1, 100);

    const wpUrl = new URL(`${DEFAULT_WP_BASE}/wp-json/wp/v2/pages`);
    wpUrl.searchParams.set('_embed', '1');
    wpUrl.searchParams.set('per_page', String(perPage));
    wpUrl.searchParams.set('page', String(page));
    wpUrl.searchParams.set('status', 'publish');
    if (slug) wpUrl.searchParams.set('slug', slug);
    if (search) wpUrl.searchParams.set('search', search);

    return fetchAndWrap(wpUrl.toString(), { env, source: 'wordpress' });
  }

  if (route === 'wp/posts') {
    const perPage = sanitizeInt(url.searchParams.get('per_page'), 6, 1, 24);
    const wpUrl = new URL(`${DEFAULT_WP_BASE}/wp-json/wp/v2/posts`);
    wpUrl.searchParams.set('_embed', '1');
    wpUrl.searchParams.set('per_page', String(perPage));
    wpUrl.searchParams.set('status', 'publish');
    return fetchAndWrap(wpUrl.toString(), { env, source: 'wordpress' });
  }

  if (route === 'opus/sample-datasheet') {
    return fetchAndWrap(SAMPLE_OPUS_DATASHEET_URL, { env, source: 'opus' });
  }

  if (route === 'opus/discover') {
    return discoverOpus(env);
  }

  if (route === 'opus') {
    const target = resolveTargetUrl(url, DEFAULT_OPUS_BASE);
    return fetchAndWrap(target, { env, source: 'opus' });
  }

  if (route === 'document') {
    const target = resolveTargetUrl(url);
    return proxyDocument(target, env);
  }

  if (route === 'raw') {
    const target = resolveTargetUrl(url);
    return fetchAndWrap(target, { env, source: detectSource(target) });
  }

  return jsonResponse({ ok: false, error: `Unknown API route: /api/${route}` }, 404);
}

async function fetchWordpressFrontPage(env) {
  const rootResp = await fetch(`${DEFAULT_WP_BASE}/wp-json/`, {
    method: 'GET',
    redirect: 'follow',
    headers: buildUpstreamHeaders('wordpress', env)
  });

  if (!rootResp.ok) {
    return jsonResponse({
      ok: false,
      source: 'wordpress',
      stage: 'fetch-root',
      status: rootResp.status,
      statusText: rootResp.statusText,
      url: `${DEFAULT_WP_BASE}/wp-json/`,
      error: await safeText(rootResp)
    }, rootResp.status);
  }

  const root = await rootResp.json();
  const frontPageId = Number(root.page_on_front || 0);

  if (!frontPageId) {
    const fallbackUrl = `${DEFAULT_WP_BASE}/wp-json/wp/v2/pages?_embed=1&per_page=1&status=publish`;
    return fetchAndWrap(fallbackUrl, {
      env,
      source: 'wordpress',
      meta: { root, warning: 'page_on_front was missing; using first published page fallback.' }
    });
  }

  const pageUrl = `${DEFAULT_WP_BASE}/wp-json/wp/v2/pages/${frontPageId}?_embed=1`;
  return fetchAndWrap(pageUrl, {
    env,
    source: 'wordpress',
    meta: { root, page_on_front: frontPageId }
  });
}

async function discoverOpus(env) {
  const candidates = [
    `${DEFAULT_OPUS_BASE}/api/v2/catalog`,
    `${DEFAULT_OPUS_BASE}/api/v2/catalog/products`,
    `${DEFAULT_OPUS_BASE}/api/v2/products`,
    `${DEFAULT_OPUS_BASE}/api/v2/items`,
    `${DEFAULT_OPUS_BASE}/api/v2/search`,
    `${DEFAULT_OPUS_BASE}/api/v2/docs`,
    `${DEFAULT_OPUS_BASE}/api/v2/openapi.json`,
    `${DEFAULT_OPUS_BASE}/api/v2/swagger.json`,
    `${DEFAULT_OPUS_BASE}/document/datasheet/00137ef9-c336-5537-8804-32b37be4e3a2`
  ];

  const results = [];
  for (const candidate of candidates) {
    const started = Date.now();
    try {
      const res = await fetch(candidate, {
        method: 'GET',
        redirect: 'follow',
        headers: buildUpstreamHeaders('opus', env)
      });
      const contentType = res.headers.get('content-type') || '';
      results.push({
        url: candidate,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        contentType,
        ms: Date.now() - started,
        hint: classifyContentType(contentType, candidate)
      });
    } catch (error) {
      results.push({
        url: candidate,
        ok: false,
        error: error?.message || String(error),
        ms: Date.now() - started
      });
    }
  }

  return jsonResponse({
    ok: true,
    source: 'opus',
    kind: 'discovery',
    message: 'This route probes a few likely Opus endpoints. The exact Swagger GET Request URL is still the best input for the Opus test.',
    results
  });
}

async function fetchAndWrap(target, options = {}) {
  const { env = {}, source = detectSource(target), meta = undefined } = options;
  validateAllowedUrl(target);

  const started = Date.now();
  const res = await fetch(target, {
    method: 'GET',
    redirect: 'follow',
    headers: buildUpstreamHeaders(source, env)
  });

  const contentType = res.headers.get('content-type') || '';
  const kind = classifyContentType(contentType, target);
  const base = {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url: target,
    finalUrl: res.url,
    source,
    contentType,
    kind,
    ms: Date.now() - started,
    meta
  };

  if (!res.ok) {
    return jsonResponse({ ...base, error: await safeText(res) }, res.status);
  }

  if (kind === 'document') {
    return jsonResponse({
      ...base,
      data: null,
      document: {
        url: target,
        proxyUrl: `/api/document?url=${encodeURIComponent(target)}`,
        title: makeDocumentTitle(target),
        contentType
      }
    });
  }

  if (contentType.includes('application/json')) {
    return jsonResponse({ ...base, data: await res.json() });
  }

  const text = await res.text();
  const parsedJson = tryParseJson(text);
  if (parsedJson.parsed) {
    return jsonResponse({ ...base, kind: 'json', data: parsedJson.value });
  }

  return jsonResponse({
    ...base,
    text,
    document: {
      url: target,
      proxyUrl: `/api/document?url=${encodeURIComponent(target)}`,
      title: makeDocumentTitle(target),
      contentType
    }
  });
}

async function proxyDocument(target, env) {
  validateAllowedUrl(target);
  const source = detectSource(target);

  const upstream = await fetch(target, {
    method: 'GET',
    redirect: 'follow',
    headers: buildUpstreamHeaders(source, env)
  });

  const headers = new Headers(upstream.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', headers.get('cache-control') || 'public, max-age=300');
  headers.delete('content-security-policy');
  headers.delete('x-frame-options');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

function buildUpstreamHeaders(source, env) {
  const headers = new Headers();
  headers.set('accept', 'application/json, text/html, application/pdf, */*');
  headers.set('user-agent', 'Ideolux-Smoke-Test-Worker/1.0');

  if (source === 'wordpress' && env.WP_USER && env.WP_APP_PASSWORD) {
    headers.set('authorization', `Basic ${btoa(`${env.WP_USER}:${env.WP_APP_PASSWORD}`)}`);
  }

  if (source === 'opus') {
    if (env.OPUS_BEARER_TOKEN) {
      headers.set('authorization', `Bearer ${env.OPUS_BEARER_TOKEN}`);
    }
    if (env.OPUS_API_KEY) {
      headers.set(env.OPUS_API_KEY_HEADER || 'x-api-key', env.OPUS_API_KEY);
    }
    if (env.OPUS_BASIC_USER && env.OPUS_BASIC_PASSWORD) {
      headers.set('authorization', `Basic ${btoa(`${env.OPUS_BASIC_USER}:${env.OPUS_BASIC_PASSWORD}`)}`);
    }
  }

  return headers;
}

function resolveTargetUrl(requestUrl, defaultBase) {
  const raw = requestUrl.searchParams.get('url') || requestUrl.searchParams.get('target') || '';
  if (!raw && !defaultBase) throw new Error('Missing url query parameter');

  const target = raw
    ? new URL(raw, defaultBase || undefined).toString()
    : new URL(defaultBase).toString();

  validateAllowedUrl(target);
  return target;
}

function validateAllowedUrl(target) {
  const parsed = new URL(target);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Blocked host: ${parsed.hostname}. Allowed: ${Array.from(ALLOWED_HOSTS).join(', ')}`);
  }
}

function detectSource(target) {
  try {
    const host = new URL(target).hostname;
    if (host.includes('hm-opus') || host.includes('products.ideolux')) return 'opus';
    if (host.includes('ideolux.it')) return 'wordpress';
  } catch (_) {}
  return 'unknown';
}

function classifyContentType(contentType, target = '') {
  const lower = `${contentType} ${target}`.toLowerCase();
  if (lower.includes('application/pdf') || lower.includes('/document/') || lower.endsWith('.pdf')) return 'document';
  if (lower.includes('application/json') || lower.includes('+json')) return 'json';
  if (lower.includes('text/html')) return 'html';
  if (lower.includes('image/')) return 'image';
  return 'unknown';
}

function makeDocumentTitle(target) {
  try {
    const url = new URL(target);
    const last = url.pathname.split('/').filter(Boolean).pop() || url.hostname;
    return decodeURIComponent(last).replace(/[-_]/g, ' ');
  } catch (_) {
    return 'Document';
  }
}

function tryParseJson(text) {
  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { parsed: false };
    return { parsed: true, value: JSON.parse(trimmed) };
  } catch (_) {
    return { parsed: false };
  }
}

async function safeText(res) {
  try {
    const text = await res.text();
    return text.slice(0, 3000);
  } catch (error) {
    return error?.message || String(error);
  }
}

function sanitizeInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}


function extractHtml(fn) {
  const source = fn.toString();
  const start = source.indexOf('/*');
  const end = source.lastIndexOf('*/');
  return source.slice(start + 2, end);
}

const INDEX_HTML = extractHtml(function(){/*<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ideolux Rendered Content Test</title>
  <style>
    :root {
      --bg: #f6f3ec;
      --paper: #fffdfa;
      --paper-2: #fdf9f2;
      --ink: #161914;
      --muted: #687062;
      --line: #ded4c3;
      --soft-line: #eadfce;
      --accent: #121610;
      --ok: #1d7d4f;
      --warn: #9a6a00;
      --bad: #a93124;
      --bad-bg: #fde1de;
      --ok-bg: #dcf3e5;
      --radius: 26px;
      --shadow: 0 20px 80px rgba(41, 35, 20, .10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(218, 204, 178, .45), transparent 36rem),
        linear-gradient(180deg, #faf8f3 0%, var(--bg) 100%);
      line-height: 1.45;
    }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 44px 24px 72px; }
    .hero {
      display: grid; grid-template-columns: 1.4fr .8fr; gap: 24px; align-items: stretch;
      background: var(--paper); border: 1px solid var(--line); border-radius: 36px;
      padding: 34px; box-shadow: var(--shadow); margin-bottom: 24px;
    }
    h1, h2, h3 { margin: 0 0 10px; line-height: 1.05; letter-spacing: -0.045em; }
    h1 { font-size: clamp(38px, 6vw, 78px); max-width: 820px; }
    h2 { font-size: clamp(25px, 3vw, 34px); }
    h3 { font-size: 20px; letter-spacing: -.025em; }
    p { color: var(--muted); margin: 0 0 18px; font-size: 16px; }
    .hero p { font-size: 19px; max-width: 780px; }
    .badge-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .badge { border: 1px solid var(--line); background: var(--paper-2); color: var(--muted); padding: 8px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; }
    .panel { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: 0 12px 50px rgba(41, 35, 20, .07); }
    .panel + .panel { margin-top: 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .status-pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 9px 12px; font-weight: 800; font-size: 13px; background: #eee7da; color: var(--muted); }
    .status-pill.ok { background: var(--ok-bg); color: var(--ok); }
    .status-pill.bad { background: var(--bad-bg); color: var(--bad); }
    .status-pill.warn { background: #fff1d1; color: var(--warn); }
    .panel-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
    label { display: block; font-weight: 800; font-size: 13px; color: var(--muted); margin: 18px 0 8px; }
    input, textarea, select {
      width: 100%; border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px;
      font: inherit; background: #fff; color: var(--ink); outline: none;
    }
    input:focus, textarea:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(22, 25, 20, .08); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    button, .button {
      appearance: none; border: 1px solid var(--line); border-radius: 999px; padding: 12px 17px;
      background: #fff; color: var(--ink); font-weight: 850; cursor: pointer; text-decoration: none; display: inline-flex; gap: 8px; align-items: center;
    }
    button.primary, .button.primary { background: var(--accent); color: white; border-color: var(--accent); }
    button:disabled { opacity: .45; cursor: wait; }
    .preview-empty, .error-box {
      min-height: 180px; display: grid; place-items: center; text-align: center;
      border: 1px dashed var(--line); border-radius: 24px; background: rgba(255,255,255,.55); padding: 28px;
    }
    .error-box { color: var(--bad); background: #fff7f6; }
    .rendered { border: 1px solid var(--line); border-radius: 24px; overflow: hidden; background: white; }
    .rendered-inner { padding: 28px; }
    .wp-hero-img { width: 100%; max-height: 440px; object-fit: cover; display: block; background: #eee; }
    .wp-meta, .small { color: var(--muted); font-size: 13px; }
    .wp-content { margin-top: 22px; font-size: 17px; }
    .wp-content img { max-width: 100%; height: auto; border-radius: 18px; }
    .wp-content a { color: inherit; text-decoration-thickness: 1px; }
    .wp-content h1, .wp-content h2, .wp-content h3 { margin-top: 28px; }
    .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
    .card { border: 1px solid var(--soft-line); border-radius: 22px; padding: 16px; background: var(--paper-2); overflow: hidden; }
    .card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 16px; margin-bottom: 12px; background: #eee; }
    .card h3 { margin-bottom: 8px; }
    .card p { font-size: 14px; margin-bottom: 10px; }
    .specs { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
    .spec { border: 1px solid var(--line); background: white; border-radius: 999px; padding: 6px 9px; font-size: 12px; color: var(--muted); }
    .document-frame { width: 100%; min-height: 760px; border: 0; background: #f3f0e8; }
    .doc-tools { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0 0; }
    details { margin-top: 16px; border: 1px solid var(--line); border-radius: 18px; background: var(--paper-2); overflow: hidden; }
    summary { cursor: pointer; padding: 14px 16px; font-weight: 850; }
    pre { margin: 0; padding: 16px; overflow: auto; font-size: 12px; line-height: 1.5; background: #171a15; color: #e8eadf; }
    .table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .table th, .table td { text-align: left; padding: 10px; border-bottom: 1px solid var(--soft-line); vertical-align: top; }
    .table th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    @media (max-width: 900px) { .hero, .grid { grid-template-columns: 1fr; } .cards { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div>
        <h1>Ideolux rendered content smoke test</h1>
        <p>This Worker renders real content from WordPress and Opus. API JSON is still available, but only as debug data below the visual preview.</p>
        <div class="badge-row">
          <span class="badge">Single Worker</span>
          <span class="badge">No Pages Functions</span>
          <span class="badge">No ASSETS binding</span>
          <span class="badge">WP + Opus proxy</span>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Health</h2>
            <p>First check that /api routes are handled by the Worker.</p>
          </div>
          <span id="health-status" class="status-pill">Not tested</span>
        </div>
        <button class="primary" id="health-btn">Run health check</button>
        <details id="health-debug"><summary>Debug JSON</summary><pre>{}</pre></details>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>1. WordPress rendered page</h2>
            <p>Fetch a real WordPress page via REST API and render title, excerpt, featured image and body HTML.</p>
          </div>
          <span id="wp-status" class="status-pill">Not tested</span>
        </div>
        <label for="wp-slug">Page slug for manual test</label>
        <input id="wp-slug" value="company" />
        <div class="actions">
          <button class="primary" id="wp-front-btn">Render front page</button>
          <button id="wp-slug-btn">Render by slug</button>
          <button id="wp-list-btn">Render pages list</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>2. Opus rendered content</h2>
            <p>Paste an exact GET Request URL from Opus Swagger. Product-like JSON becomes cards. Datasheets/documents become embedded previews.</p>
          </div>
          <span id="opus-status" class="status-pill">Not tested</span>
        </div>
        <label for="opus-url">Opus API / document URL</label>
        <input id="opus-url" value="https://ideolux.hm-opus.com/document/datasheet/00137ef9-c336-5537-8804-32b37be4e3a2" />
        <div class="actions">
          <button class="primary" id="opus-url-btn">Render Opus URL</button>
          <button id="opus-sample-btn">Render sample datasheet</button>
          <button id="opus-discovery-btn">Try discovery</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Rendered preview</h2>
          <p>The latest selected response is rendered here as page content, product cards, discovery table or document preview.</p>
        </div>
        <span id="preview-status" class="status-pill">Waiting</span>
      </div>
      <div id="preview" class="preview-empty">
        <div>
          <h3>No content rendered yet</h3>
          <p>Click “Render front page” for WordPress or “Render Opus URL” for catalog/document source.</p>
        </div>
      </div>
      <details id="main-debug"><summary>Debug JSON for latest response</summary><pre>{}</pre></details>
    </section>

    <section class="panel">
      <h2>What this proves</h2>
      <div class="cards">
        <div class="card"><h3>WP content renders visually</h3><p>We can use WordPress as a CMS source for public pages.</p></div>
        <div class="card"><h3>Opus can stay separate</h3><p>Opus API/document output is treated as a separate product/catalog source.</p></div>
        <div class="card"><h3>Proxy avoids CORS</h3><p>All upstream requests run server-side through this Worker, so frontend CORS is not blocking the test.</p></div>
      </div>
    </section>
  </div>

  <script>
    const state = { latest: null };

    const $ = (id) => document.getElementById(id);

    $('health-btn').addEventListener('click', () => runHealth());
    $('wp-front-btn').addEventListener('click', () => runWp('/api/wp/frontpage', 'front page'));
    $('wp-slug-btn').addEventListener('click', () => {
      const slug = $('wp-slug').value.trim() || 'company';
      runWp('/api/wp/pages?slug=' + encodeURIComponent(slug) + '&per_page=6', 'slug ' + slug);
    });
    $('wp-list-btn').addEventListener('click', () => runWp('/api/wp/pages?per_page=9', 'pages list'));
    $('opus-url-btn').addEventListener('click', () => {
      const url = $('opus-url').value.trim();
      if (!url) return setPreviewError('Missing Opus URL');
      runOpus('/api/opus?url=' + encodeURIComponent(url), 'custom Opus URL');
    });
    $('opus-sample-btn').addEventListener('click', () => runOpus('/api/opus/sample-datasheet', 'sample datasheet'));
    $('opus-discovery-btn').addEventListener('click', () => runOpus('/api/opus/discover', 'Opus discovery'));

    async function runHealth() {
      setStatus('health-status', 'Loading', 'warn');
      const result = await fetchJson('/api/health');
      setStatus('health-status', formatStatus(result), result.ok ? 'ok' : 'bad');
      setDebug('health-debug', result);
    }

    async function runWp(endpoint, label) {
      setStatus('wp-status', 'Loading', 'warn');
      setStatus('preview-status', 'Loading WP', 'warn');
      setPreviewLoading('Loading WordPress ' + label + '…');
      const result = await fetchJson(endpoint);
      setStatus('wp-status', formatStatus(result), result.ok ? 'ok' : 'bad');
      state.latest = result;
      setDebug('main-debug', result);
      if (!result.ok) return setPreviewError(result.error || result.statusText || 'WordPress request failed');
      renderWp(result);
    }

    async function runOpus(endpoint, label) {
      setStatus('opus-status', 'Loading', 'warn');
      setStatus('preview-status', 'Loading Opus', 'warn');
      setPreviewLoading('Loading Opus ' + label + '…');
      const result = await fetchJson(endpoint);
      setStatus('opus-status', formatStatus(result), result.ok ? 'ok' : 'bad');
      state.latest = result;
      setDebug('main-debug', result);
      if (!result.ok) return setPreviewError(result.error || result.statusText || 'Opus request failed');
      renderOpus(result);
    }

    async function fetchJson(endpoint) {
      const started = performance.now();
      try {
        const res = await fetch(endpoint, { headers: { accept: 'application/json' } });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch (_) { data = { ok: res.ok, status: res.status, text }; }
        if (typeof data.ok === 'undefined') data.ok = res.ok;
        if (!data.status) data.status = res.status;
        data.clientMs = Math.round(performance.now() - started);
        return data;
      } catch (error) {
        return { ok: false, error: error.message || String(error), clientMs: Math.round(performance.now() - started) };
      }
    }

    function renderWp(envelope) {
      const data = envelope.data;
      if (Array.isArray(data)) {
        if (!data.length) return setPreviewEmpty('No WordPress pages found', 'Try another slug or fetch the full pages list.');
        if (data.length === 1) return renderWpPage(data[0], envelope);
        return renderWpCards(data, envelope);
      }
      renderWpPage(data, envelope);
    }

    function renderWpPage(page, envelope) {
      const title = html(page?.title?.rendered || page?.title || 'Untitled WordPress page');
      const excerpt = sanitizeHtml(page?.excerpt?.rendered || '');
      const content = sanitizeHtml(page?.content?.rendered || '<p>No body content returned.</p>');
      const featured = getFeaturedImage(page);
      const link = page?.link || envelope?.url || '#';
      const slug = page?.slug ? '<span class="badge">slug: ' + escapeHtml(page.slug) + '</span>' : '';
      const id = page?.id ? '<span class="badge">id: ' + escapeHtml(page.id) + '</span>' : '';

      $('preview').className = 'rendered';
      $('preview').innerHTML = `
        ${featured ? `<img class="wp-hero-img" src="${escapeAttr(featured)}" alt="" loading="lazy" />` : ''}
        <div class="rendered-inner">
          <div class="badge-row">${id}${slug}<span class="badge">WordPress</span></div>
          <h2>${title}</h2>
          ${excerpt ? `<div class="wp-meta">${excerpt}</div>` : ''}
          <div class="doc-tools"><a class="button" href="${escapeAttr(link)}" target="_blank" rel="noreferrer">Open original WP page</a></div>
          <div class="wp-content">${content}</div>
        </div>`;
      setStatus('preview-status', 'Rendered WP', 'ok');
    }

    function renderWpCards(pages, envelope) {
      $('preview').className = 'rendered';
      $('preview').innerHTML = `
        <div class="rendered-inner">
          <h2>WordPress pages list</h2>
          <p>Rendered from <code>${escapeHtml(envelope.url || '')}</code></p>
          <div class="cards">
            ${pages.map(page => `
              <article class="card">
                ${getFeaturedImage(page) ? `<img src="${escapeAttr(getFeaturedImage(page))}" alt="" loading="lazy" />` : ''}
                <h3>${html(page?.title?.rendered || page?.title || 'Untitled')}</h3>
                <p>${textFromHtml(page?.excerpt?.rendered || '').slice(0, 180) || 'No excerpt.'}</p>
                <div class="specs">
                  ${page.id ? `<span class="spec">ID ${escapeHtml(page.id)}</span>` : ''}
                  ${page.slug ? `<span class="spec">${escapeHtml(page.slug)}</span>` : ''}
                </div>
                ${page.link ? `<p><a href="${escapeAttr(page.link)}" target="_blank" rel="noreferrer">Open page</a></p>` : ''}
              </article>
            `).join('')}
          </div>
        </div>`;
      setStatus('preview-status', 'Rendered WP list', 'ok');
    }

    function renderOpus(envelope) {
      if (envelope.kind === 'discovery') return renderDiscovery(envelope);
      if (envelope.kind === 'document' || envelope.document) return renderDocument(envelope);
      if (envelope.kind === 'html' && envelope.document) return renderDocument(envelope);
      if (envelope.data) return renderProductLikeData(envelope);
      if (envelope.text) return renderTextDocument(envelope);
      setPreviewEmpty('Opus response loaded', 'The response did not contain recognizable JSON or document content. Check Debug JSON.');
      setStatus('preview-status', 'Loaded Opus', 'warn');
    }

    function renderDocument(envelope) {
      const doc = envelope.document || {};
      const proxyUrl = doc.proxyUrl || ('/api/document?url=' + encodeURIComponent(envelope.url));
      const title = doc.title || 'Document preview';
      $('preview').className = 'rendered';
      $('preview').innerHTML = `
        <div class="rendered-inner">
          <div class="badge-row"><span class="badge">Opus document</span><span class="badge">${escapeHtml(envelope.contentType || 'document')}</span></div>
          <h2>${escapeHtml(title)}</h2>
          <p>This is rendered as an embedded document preview through the Worker proxy.</p>
          <div class="doc-tools">
            <a class="button primary" href="${escapeAttr(proxyUrl)}" target="_blank" rel="noreferrer">Open proxied document</a>
            <a class="button" href="${escapeAttr(envelope.url || doc.url || '#')}" target="_blank" rel="noreferrer">Open original URL</a>
          </div>
        </div>
        <iframe class="document-frame" src="${escapeAttr(proxyUrl)}" title="Opus document preview"></iframe>`;
      setStatus('preview-status', 'Rendered document', 'ok');
    }

    function renderProductLikeData(envelope) {
      const products = collectProductLikeObjects(envelope.data).slice(0, 24);
      if (!products.length) {
        $('preview').className = 'rendered';
        $('preview').innerHTML = `
          <div class="rendered-inner">
            <h2>Opus JSON loaded</h2>
            <p>The JSON loaded successfully, but it does not look like product cards yet. This usually means we need to map the exact Opus response fields.</p>
            ${renderJsonSummary(envelope.data)}
          </div>`;
        setStatus('preview-status', 'JSON loaded', 'warn');
        return;
      }

      $('preview').className = 'rendered';
      $('preview').innerHTML = `
        <div class="rendered-inner">
          <div class="badge-row"><span class="badge">Opus JSON</span><span class="badge">${products.length} detected cards</span></div>
          <h2>Opus product/catalog cards</h2>
          <p>Objects were normalized from the API response. Exact field mapping can be tightened after client provides the final Swagger endpoint.</p>
          <div class="cards">
            ${products.map(renderProductCard).join('')}
          </div>
        </div>`;
      setStatus('preview-status', 'Rendered Opus cards', 'ok');
    }

    function renderProductCard(item) {
      const title = item.title || item.name || item.productName || item.product_name || item.label || item.family || item.series || 'Unnamed product';
      const sku = item.sku || item.SKU || item.code || item.itemCode || item.productCode || item.reference || item.model || item.article || '';
      const desc = item.description || item.shortDescription || item.short_description || item.summary || item.text || '';
      const image = findImageUrl(item);
      const links = findLinks(item).slice(0, 4);
      const specs = collectSpecs(item).slice(0, 12);

      return `<article class="card">
        ${image ? `<img src="${escapeAttr(image)}" alt="" loading="lazy" />` : ''}
        <h3>${escapeHtml(String(title))}</h3>
        ${sku ? `<p><strong>${escapeHtml(String(sku))}</strong></p>` : ''}
        ${desc ? `<p>${escapeHtml(stripHtml(String(desc)).slice(0, 220))}</p>` : ''}
        ${specs.length ? `<div class="specs">${specs.map(s => `<span class="spec">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
        ${links.length ? `<div class="doc-tools">${links.map(link => `<a class="button" href="${escapeAttr(link)}" target="_blank" rel="noreferrer">Open link</a>`).join('')}</div>` : ''}
      </article>`;
    }

    function renderDiscovery(envelope) {
      const rows = (envelope.results || []).map(item => `
        <tr>
          <td>${item.ok ? '<span class="status-pill ok">OK</span>' : '<span class="status-pill bad">Fail</span>'}</td>
          <td><a href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url)}</a></td>
          <td>${escapeHtml(item.status || item.error || '')}</td>
          <td>${escapeHtml(item.contentType || '')}</td>
          <td>${escapeHtml(item.hint || '')}</td>
        </tr>`).join('');
      $('preview').className = 'rendered';
      $('preview').innerHTML = `
        <div class="rendered-inner">
          <h2>Opus discovery results</h2>
          <p>This checks likely endpoints, but the exact Swagger GET Request URL is still the best source for product JSON.</p>
          <table class="table"><thead><tr><th>Result</th><th>URL</th><th>Status</th><th>Type</th><th>Hint</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
      setStatus('preview-status', 'Discovery rendered', 'ok');
    }

    function renderTextDocument(envelope) {
      $('preview').className = 'rendered';
      $('preview').innerHTML = `
        <div class="rendered-inner">
          <h2>Text / HTML response</h2>
          <p>The endpoint returned text/html or plain text. Showing a safe preview below.</p>
          <pre>${escapeHtml((envelope.text || '').slice(0, 6000))}</pre>
        </div>`;
      setStatus('preview-status', 'Rendered text', 'ok');
    }

    function collectProductLikeObjects(root) {
      const results = [];
      const seen = new WeakSet();
      const productKeys = ['sku','SKU','code','itemCode','productCode','productName','product_name','family','series','wattage','lumen','lumens','colorTemperature','beamAngle','article','model'];
      const titleKeys = ['title','name','label','description'];

      function visit(value, depth = 0) {
        if (!value || depth > 8) return;
        if (Array.isArray(value)) {
          for (const child of value) visit(child, depth + 1);
          return;
        }
        if (typeof value !== 'object') return;
        if (seen.has(value)) return;
        seen.add(value);

        const keys = Object.keys(value);
        const hasProductKey = productKeys.some(k => Object.prototype.hasOwnProperty.call(value, k));
        const hasTitleKey = titleKeys.some(k => Object.prototype.hasOwnProperty.call(value, k));
        const hasEnoughFields = keys.length >= 3;
        const notHugeWrapper = keys.length < 80;
        if ((hasProductKey || hasTitleKey) && hasEnoughFields && notHugeWrapper) {
          results.push(value);
        }

        for (const key of keys) {
          const child = value[key];
          if (child && typeof child === 'object') visit(child, depth + 1);
        }
      }

      visit(root);
      return dedupeBySignature(results);
    }

    function dedupeBySignature(items) {
      const seen = new Set();
      const out = [];
      for (const item of items) {
        const sig = String(item.id || item.sku || item.SKU || item.code || item.productCode || item.name || item.title || JSON.stringify(item).slice(0, 120));
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(item);
      }
      return out;
    }

    function collectSpecs(item) {
      const skip = new Set(['id','uuid','title','name','productName','product_name','description','shortDescription','short_description','summary','text','image','images','media','picture','pictures','url','link','links','href']);
      const specs = [];
      for (const [key, value] of Object.entries(item || {})) {
        if (skip.has(key)) continue;
        if (value == null) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          const stringValue = String(value).trim();
          if (stringValue && stringValue.length <= 60) specs.push(`${humanizeKey(key)}: ${stringValue}`);
        }
      }
      return specs;
    }

    function findImageUrl(obj) {
      const urls = findUrls(obj).filter(u => /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u) || /image|media|picture/i.test(u));
      return urls[0] || '';
    }

    function findLinks(obj) {
      return findUrls(obj).filter(u => !/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u));
    }

    function findUrls(obj, depth = 0, out = []) {
      if (!obj || depth > 5 || out.length > 40) return out;
      if (typeof obj === 'string') {
        if (/^https?:\/\//i.test(obj)) out.push(obj);
        return out;
      }
      if (Array.isArray(obj)) {
        obj.forEach(v => findUrls(v, depth + 1, out));
        return out;
      }
      if (typeof obj === 'object') {
        Object.values(obj).forEach(v => findUrls(v, depth + 1, out));
      }
      return out;
    }

    function getFeaturedImage(page) {
      return page?._embedded?.['wp:featuredmedia']?.[0]?.source_url || page?.featured_image_src || '';
    }

    function renderJsonSummary(data) {
      if (Array.isArray(data)) return `<p>Array with ${data.length} item(s).</p>`;
      if (data && typeof data === 'object') return `<div class="specs">${Object.keys(data).slice(0, 24).map(k => `<span class="spec">${escapeHtml(k)}</span>`).join('')}</div>`;
      return `<p>${escapeHtml(String(data))}</p>`;
    }

    function setPreviewLoading(message) {
      $('preview').className = 'preview-empty';
      $('preview').innerHTML = `<div><h3>${escapeHtml(message)}</h3><p>Please wait while the Worker fetches and renders upstream content.</p></div>`;
    }

    function setPreviewEmpty(title, body) {
      $('preview').className = 'preview-empty';
      $('preview').innerHTML = `<div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body || '')}</p></div>`;
      setStatus('preview-status', 'Empty', 'warn');
    }

    function setPreviewError(message) {
      $('preview').className = 'error-box';
      $('preview').innerHTML = `<div><h3>Request failed</h3><p>${escapeHtml(message || 'Unknown error')}</p></div>`;
      setStatus('preview-status', 'Error', 'bad');
    }

    function setStatus(id, text, mode) {
      const el = $(id);
      el.className = 'status-pill' + (mode ? ' ' + mode : '');
      el.textContent = text;
    }

    function setDebug(id, data) {
      const el = $(id).querySelector('pre');
      el.textContent = JSON.stringify(data, null, 2);
    }

    function formatStatus(result) {
      if (!result) return 'No result';
      const status = result.status || (result.ok ? 200 : 'Error');
      const ms = result.ms || result.clientMs;
      return status + (ms ? ' · ' + ms + 'ms' : '');
    }

    function sanitizeHtml(input) {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(input || '');
      tpl.content.querySelectorAll('script, iframe[src*="javascript:"], object, embed').forEach(node => node.remove());
      tpl.content.querySelectorAll('*').forEach(node => {
        [...node.attributes].forEach(attr => {
          if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
          if ((attr.name === 'href' || attr.name === 'src') && /^javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
        });
      });
      return tpl.innerHTML;
    }

    function html(input) { return sanitizeHtml(input); }
    function stripHtml(input) { const div = document.createElement('div'); div.innerHTML = String(input || ''); return div.textContent || div.innerText || ''; }
    function textFromHtml(input) { return stripHtml(input).replace(/\s+/g, ' ').trim(); }
    function escapeHtml(input) { return String(input ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function escapeAttr(input) { return escapeHtml(input); }
    function humanizeKey(key) { return String(key).replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'); }

    runHealth();
  </script>
</body>
</html>*/});
