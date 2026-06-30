import { fetchWp, json } from '../../../shared/wp-utils.js';

export async function onRequestGet({ env }) {
  try {
    const { data, status, upstreamUrl } = await fetchWp('/', env);
    return json({
      ok: true,
      source: 'wordpress',
      type: 'root',
      status,
      upstreamUrl,
      site: {
        name: data.name,
        description: data.description,
        url: data.url,
        home: data.home,
        page_on_front: data.page_on_front,
        show_on_front: data.show_on_front,
        namespaces: data.namespaces,
      },
      raw: data,
    });
  } catch (error) {
    return json({ ok: false, source: 'wordpress', error: error.message }, 502);
  }
}
