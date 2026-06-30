import { fetchWp, json, normalizeWpPage } from '../../../shared/wp-utils.js';

export async function onRequestGet({ env }) {
  try {
    const root = await fetchWp('/', env);
    const frontPageId = root.data.page_on_front;

    if (!frontPageId) {
      return json({ ok: false, source: 'wordpress', error: 'WordPress root did not return page_on_front' }, 404);
    }

    const pageResponse = await fetchWp(`/wp/v2/pages/${frontPageId}?_embed=wp:featuredmedia`, env);
    const page = normalizeWpPage(pageResponse.data);

    return json({
      ok: true,
      source: 'wordpress',
      type: 'frontpage',
      status: pageResponse.status,
      upstreamUrl: pageResponse.upstreamUrl,
      page,
      raw: pageResponse.data,
    });
  } catch (error) {
    return json({ ok: false, source: 'wordpress', error: error.message }, 502);
  }
}
