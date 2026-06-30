export const WP_BASE = 'https://ideolux.it/wp-json';

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function wpHeaders(env = {}) {
  const headers = {
    accept: 'application/json',
    'user-agent': 'Ideolux API Renderer / Cloudflare Pages Function',
  };

  if (env.WP_USER && env.WP_APP_PASSWORD) {
    headers.authorization = `Basic ${btoa(`${env.WP_USER}:${env.WP_APP_PASSWORD}`)}`;
  }

  return headers;
}

export async function fetchWp(path, env = {}) {
  const url = `${WP_BASE}${path}`;
  const response = await fetch(url, { headers: wpHeaders(env) });
  const contentType = response.headers.get('content-type') || '';
  let data;

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = { error: await response.text() };
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `WordPress HTTP ${response.status}`);
  }

  return { data, status: response.status, upstreamUrl: url };
}

export function normalizeWpPage(page) {
  if (!page || typeof page !== 'object') return null;

  const embedded = page._embedded || {};
  const featuredMedia = embedded['wp:featuredmedia']?.[0];
  const featuredImage = featuredMedia?.source_url || featuredMedia?.media_details?.sizes?.large?.source_url || '';

  return {
    id: page.id,
    slug: page.slug,
    title: page.title?.rendered ? stripWpTitle(page.title.rendered) : `Page ${page.id || ''}`.trim(),
    excerpt: page.excerpt?.rendered || '',
    excerptText: stripHtml(page.excerpt?.rendered || '').slice(0, 220),
    contentHtml: page.content?.rendered || '',
    featuredImage,
    link: page.link,
    date: page.date,
    modified: page.modified,
    rawType: page.type,
  };
}

function stripHtml(html = '') {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripWpTitle(title = '') {
  return stripHtml(title).replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&amp;/g, '&');
}
