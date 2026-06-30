const DEFAULT_OPUS_URL = 'https://ideolux.hm-opus.com/document/datasheet/00137ef9-c336-5537-8804-32b37be4e3a2';
const ALLOWED_HOSTS = new Set(['ideolux.hm-opus.com', 'products.ideolux.it']);

export async function onRequestGet({ request, env }) {
  const currentUrl = new URL(request.url);
  const target = currentUrl.searchParams.get('url') || DEFAULT_OPUS_URL;

  let upstream;
  try {
    upstream = new URL(target);
  } catch {
    return json({ ok: false, source: 'opus', error: 'Invalid Opus URL' }, 400);
  }

  if (upstream.protocol !== 'https:' || !ALLOWED_HOSTS.has(upstream.hostname)) {
    return json({
      ok: false,
      source: 'opus',
      error: `Blocked host. Allowed hosts: ${Array.from(ALLOWED_HOSTS).join(', ')}`,
    }, 400);
  }

  const headers = {
    accept: 'application/json, text/html, application/pdf, */*',
    'user-agent': 'Ideolux API Renderer / Cloudflare Pages Function',
  };

  if (env.OPUS_BEARER_TOKEN) {
    headers.authorization = `Bearer ${env.OPUS_BEARER_TOKEN}`;
  }

  if (env.OPUS_API_KEY && env.OPUS_API_KEY_HEADER) {
    headers[env.OPUS_API_KEY_HEADER] = env.OPUS_API_KEY;
  }

  try {
    const response = await fetch(upstream.toString(), { headers });
    const contentType = response.headers.get('content-type') || '';
    const upstreamStatus = response.status;

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {}
      return json({
        ok: false,
        source: 'opus',
        url: upstream.toString(),
        upstreamStatus,
        contentType,
        error: `Opus request failed with HTTP ${upstreamStatus}`,
        bodyPreview: body.slice(0, 1200),
      }, 502);
    }

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return json({
        ok: true,
        source: 'opus',
        kind: 'json',
        status: upstreamStatus,
        upstreamStatus,
        contentType,
        url: upstream.toString(),
        data,
      });
    }

    if (looksLikeJsonEndpoint(upstream) && contentType.includes('text/')) {
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        return json({
          ok: true,
          source: 'opus',
          kind: 'json',
          status: upstreamStatus,
          upstreamStatus,
          contentType,
          url: upstream.toString(),
          data,
        });
      } catch {
        return json({
          ok: true,
          source: 'opus',
          kind: 'document',
          status: upstreamStatus,
          upstreamStatus,
          contentType,
          url: upstream.toString(),
          previewUrl: upstream.toString(),
          title: titleFromUrl(upstream),
          bodyPreview: text.slice(0, 1200),
        });
      }
    }

    return json({
      ok: true,
      source: 'opus',
      kind: 'document',
      status: upstreamStatus,
      upstreamStatus,
      contentType,
      url: upstream.toString(),
      previewUrl: upstream.toString(),
      title: titleFromUrl(upstream),
    });
  } catch (error) {
    return json({ ok: false, source: 'opus', url: upstream.toString(), error: error.message }, 502);
  }
}

function looksLikeJsonEndpoint(url) {
  return url.pathname.includes('/api/') || url.pathname.endsWith('.json');
}

function titleFromUrl(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.includes('datasheet')) return 'Ideolux Opus datasheet';
  return parts.at(-1) || 'Opus document';
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
