import { fetchWp, json, normalizeWpPage } from '../../../shared/wp-utils.js';

export async function onRequestGet({ request, env }) {
  try {
    const currentUrl = new URL(request.url);
    const slug = currentUrl.searchParams.get('slug')?.trim();
    const perPage = Math.min(Math.max(parseInt(currentUrl.searchParams.get('perPage') || '9', 10), 1), 20);

    const path = slug
      ? `/wp/v2/pages?slug=${encodeURIComponent(slug)}&_embed=wp:featuredmedia`
      : `/wp/v2/pages?per_page=${perPage}&orderby=menu_order&order=asc&_embed=wp:featuredmedia`;

    const response = await fetchWp(path, env);
    const pages = Array.isArray(response.data) ? response.data : [];
    const items = pages.map(normalizeWpPage).filter(Boolean);

    if (slug) {
      if (!items.length) {
        return json({ ok: false, source: 'wordpress', type: 'page-by-slug', slug, error: `No published WordPress page found for slug: ${slug}` }, 404);
      }
      return json({
        ok: true,
        source: 'wordpress',
        type: 'page-by-slug',
        status: response.status,
        upstreamUrl: response.upstreamUrl,
        page: items[0],
        raw: pages[0],
      });
    }

    return json({
      ok: true,
      source: 'wordpress',
      type: 'pages-list',
      status: response.status,
      upstreamUrl: response.upstreamUrl,
      count: items.length,
      items,
      raw: response.data,
    });
  } catch (error) {
    return json({ ok: false, source: 'wordpress', error: error.message }, 502);
  }
}
