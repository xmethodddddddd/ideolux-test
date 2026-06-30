export async function onRequestGet() {
  return json({
    ok: true,
    service: 'ideolux-cloudflare-pages-api-renderer',
    time: new Date().toISOString(),
  });
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
