# Ideolux Cloudflare Pages API Renderer

Simple test site for rendering real content from two sources:

1. **WordPress REST API** from `https://ideolux.it/wp-json/`
2. **Opus / HM Opus** URLs from `https://ideolux.hm-opus.com/` or `https://products.ideolux.it/`

The site does not show only raw JSON. It renders:

- WordPress pages as real page previews: title, excerpt, image, body HTML
- WordPress page lists as cards
- Opus JSON as generic product/content cards
- Opus documents/datasheets as embedded previews
- raw debug JSON only inside the Debug accordion

## File structure

```txt
public/
  index.html
  styles.css
  app.js
  _headers
functions/
  api/
    health.js
    opus.js
    wp/
      root.js
      frontpage.js
      pages.js
shared/
  wp-utils.js
package.json
README.md
```

## Recommended deployment: Cloudflare Pages + Git

Use **Cloudflare Pages**, not a standalone Worker deploy.

### Cloudflare Pages build settings

When creating the Pages project from Git, use:

```txt
Framework preset: None
Build command: exit 0
Build output directory: public
Root directory: /
```

Important: do **not** use this deploy command:

```txt
npx wrangler deploy
```

That command is for Workers, not this Pages project. This project uses `/functions` for API routes.

## Do I need to run anything locally?

No.

If you push these files to GitHub/GitLab and connect the repo to Cloudflare Pages with the settings above, the site should open directly on the generated `*.pages.dev` link.

Local run is optional only for debugging:

```bash
npm install
npm run dev
```

Then open the URL shown by Wrangler, usually `http://localhost:8788`.

## Test URLs after deploy

Open these in the browser after deployment:

```txt
https://YOUR-PROJECT.pages.dev/api/health
https://YOUR-PROJECT.pages.dev/api/wp/root
https://YOUR-PROJECT.pages.dev/api/wp/frontpage
https://YOUR-PROJECT.pages.dev/api/wp/pages?slug=company
https://YOUR-PROJECT.pages.dev/api/opus?url=https%3A%2F%2Fideolux.hm-opus.com%2Fdocument%2Fdatasheet%2F00137ef9-c336-5537-8804-32b37be4e3a2
```

If `/api/health` returns `ok: true`, Pages Functions are deployed correctly.

## WordPress auth, if needed later

Public published pages should work without credentials.

If you need private pages, drafts or protected fields, create a WordPress Application Password:

```txt
WP Admin → Users → Profile → Application Passwords
```

Then add these Cloudflare Pages environment variables:

```txt
WP_USER
WP_APP_PASSWORD
```

Do not put real credentials into frontend JS.

## Opus auth, if needed later

If the Opus API endpoint requires auth, add Cloudflare Pages environment variables:

Bearer token:

```txt
OPUS_BEARER_TOKEN
```

or custom API key header:

```txt
OPUS_API_KEY_HEADER
OPUS_API_KEY
```

Examples:

```txt
OPUS_API_KEY_HEADER=x-api-key
OPUS_API_KEY=xxxx
```

or:

```txt
OPUS_API_KEY_HEADER=x-service-key
OPUS_API_KEY=xxxx
```

Do not put Opus tokens into `public/app.js`.

## How to test Opus

1. Open the Opus Swagger URL from the client.
2. Open any GET method under `Opus:Catalog`.
3. Click `Try it out` → `Execute`.
4. Copy the exact `Request URL`.
5. Paste that URL into the Opus input on the rendered test site.
6. Click `Render Opus URL`.

If the endpoint returns product-like JSON, the frontend will render cards.
If the endpoint returns a document or datasheet, the frontend will render an embedded preview.
If it returns 401/403, credentials are required.
