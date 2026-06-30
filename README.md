# Ideolux rendered content smoke test — single Cloudflare Worker

This is the safest version for `*.workers.dev` deployment.

It is intentionally self-contained:

- `/` returns the rendered HTML interface.
- `/api/*` is handled by the same Worker.
- No `wrangler.toml` is required for dashboard paste.
- No Cloudflare Pages Functions are required.
- No `env.ASSETS` binding is required.
- No build step is required.

## Fastest deploy through Cloudflare dashboard

1. Open Cloudflare → Workers & Pages.
2. Create or open your Worker.
3. Click **Edit code**.
4. Delete the existing code.
5. Paste the full content of `worker.js`.
6. Click **Save and deploy**.
7. Open the Worker URL.
8. Click **Run health check** first.
9. Click **Render front page**.
10. For Opus, paste an exact GET Request URL from the Opus Swagger and click **Render Opus URL**.

## Why this version fixes the 404 problem

The previous deployment showed the static HTML page, but `/api/*` routes returned 404. That usually means the API Worker/Pages Function was not attached to the uploaded static assets.

This version removes that dependency. The same Worker serves both the HTML and the API routes, so `/api/health`, `/api/wp/frontpage`, and `/api/opus?...` are handled by the deployed Worker itself.

## Optional secrets

Public WordPress pages should work without auth.

If WordPress private/draft/admin data is needed, add Worker secrets:

- `WP_USER`
- `WP_APP_PASSWORD`

If Opus API requires auth, add one of:

- `OPUS_BEARER_TOKEN`
- `OPUS_API_KEY` and optional `OPUS_API_KEY_HEADER`
- `OPUS_BASIC_USER` and `OPUS_BASIC_PASSWORD`

## Built-in upstreams

- WordPress: `https://ideolux.it/wp-json/`
- WordPress front page: taken from `page_on_front` in the REST root
- Opus sample document: `https://ideolux.hm-opus.com/document/datasheet/00137ef9-c336-5537-8804-32b37be4e3a2`

## Security note

The proxy is intentionally restricted to these hosts only:

- `ideolux.it`
- `www.ideolux.it`
- `ideolux.hm-opus.com`
- `products.ideolux.it`

This prevents the Worker from becoming a generic open proxy.
