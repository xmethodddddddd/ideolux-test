const state = {
  last: null,
};

const els = {
  preview: document.querySelector('#preview'),
  debug: document.querySelector('#debugOutput'),
  previewStatus: document.querySelector('#previewStatus'),
  wpStatus: document.querySelector('#wpStatus'),
  opusStatus: document.querySelector('#opusStatus'),
  wpSlug: document.querySelector('#wpSlug'),
  opusUrl: document.querySelector('#opusUrl'),
  healthBtn: document.querySelector('#healthBtn'),
  wpFrontBtn: document.querySelector('#wpFrontBtn'),
  wpSlugBtn: document.querySelector('#wpSlugBtn'),
  wpListBtn: document.querySelector('#wpListBtn'),
  opusFetchBtn: document.querySelector('#opusFetchBtn'),
  opusSampleBtn: document.querySelector('#opusSampleBtn'),
};

const SAMPLE_OPUS_URL = 'https://ideolux.hm-opus.com/document/datasheet/00137ef9-c336-5537-8804-32b37be4e3a2';

function setStatus(el, text, type = 'idle') {
  el.textContent = text;
  el.className = `status ${type}`;
}

function setLoading(scope, label = 'Loading') {
  setStatus(els.previewStatus, label, 'loading');
  if (scope === 'wp') setStatus(els.wpStatus, label, 'loading');
  if (scope === 'opus') setStatus(els.opusStatus, label, 'loading');
  setButtons(true);
}

function setDone(scope, label = 'OK') {
  setStatus(els.previewStatus, label, 'ok');
  if (scope === 'wp') setStatus(els.wpStatus, label, 'ok');
  if (scope === 'opus') setStatus(els.opusStatus, label, 'ok');
  setButtons(false);
}

function setError(scope, message = 'Error') {
  setStatus(els.previewStatus, 'Error', 'error');
  if (scope === 'wp') setStatus(els.wpStatus, 'Error', 'error');
  if (scope === 'opus') setStatus(els.opusStatus, 'Error', 'error');
  setButtons(false);
  els.preview.className = 'preview';
  els.preview.innerHTML = `<div class="errorBox"><h3>Request failed</h3><p>${escapeHtml(message)}</p></div>`;
}

function setButtons(disabled) {
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const contentType = response.headers.get('content-type') || '';
  let payload;
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    payload = { ok: false, error: await response.text() };
  }
  if (!response.ok || payload.ok === false) {
    const message = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { payload, status: response.status });
  }
  return payload;
}

function updateDebug(payload) {
  state.last = payload;
  els.debug.textContent = JSON.stringify(payload, null, 2);
}

async function run(scope, url, renderer, label = 'Loading') {
  try {
    setLoading(scope, label);
    const payload = await getJson(url);
    updateDebug(payload);
    renderer(payload);
    setDone(scope, payload.status ? `${payload.status}` : 'Rendered');
  } catch (error) {
    updateDebug(error.payload || { ok: false, error: error.message, status: error.status });
    setError(scope, error.message || 'Unknown error');
  }
}

function renderHealth(payload) {
  els.preview.className = 'preview';
  els.preview.innerHTML = `
    <div class="wpPage">
      <p class="eyebrow">Health check</p>
      <h2>${payload.ok ? 'Cloudflare Pages Functions are working' : 'Health check failed'}</h2>
      <p class="muted">API route: <strong>${escapeHtml(payload.service || 'unknown')}</strong></p>
      <p class="muted">Time: ${escapeHtml(payload.time || '')}</p>
    </div>
  `;
}

function renderWpPage(payload) {
  const page = payload.page || payload.item || payload;
  if (!page || !page.title) throw new Error('No WordPress page data to render');

  els.preview.className = 'preview';
  els.preview.innerHTML = `
    <article class="wpPage">
      <div class="wpMeta">
        <span>WordPress</span>
        ${page.slug ? `<span>/${escapeHtml(page.slug)}</span>` : ''}
        ${page.date ? `<span>${formatDate(page.date)}</span>` : ''}
      </div>
      <h1 class="wpTitle">${escapeHtml(page.title)}</h1>
      ${page.excerpt ? `<div class="wpExcerpt">${page.excerpt}</div>` : ''}
      ${page.featuredImage ? `<img class="wpHeroImage" src="${escapeAttr(page.featuredImage)}" alt="${escapeAttr(page.title)}" loading="lazy" />` : ''}
      ${page.contentHtml ? `<div class="wpContent">${page.contentHtml}</div>` : '<p class="muted">No body content returned.</p>'}
      ${page.link ? `<p><a class="btn secondary" href="${escapeAttr(page.link)}" target="_blank" rel="noreferrer">Open original page</a></p>` : ''}
    </article>
  `;
}

function renderWpList(payload) {
  const items = payload.items || [];
  if (!items.length) throw new Error('No WordPress pages returned');

  els.preview.className = 'preview';
  els.preview.innerHTML = `
    <div class="cards">
      ${items.map((item) => `
        <article class="contentCard">
          ${item.featuredImage ? `<img src="${escapeAttr(item.featuredImage)}" alt="${escapeAttr(item.title)}" loading="lazy" />` : ''}
          <div>
            <p class="eyebrow">WordPress page</p>
            <h3>${escapeHtml(item.title || 'Untitled')}</h3>
          </div>
          ${item.excerptText ? `<p>${escapeHtml(item.excerptText)}</p>` : ''}
          ${item.slug ? `<button class="btn secondary miniWpSlug" data-slug="${escapeAttr(item.slug)}">Render this page</button>` : ''}
          ${item.link ? `<a href="${escapeAttr(item.link)}" target="_blank" rel="noreferrer">Open original</a>` : ''}
        </article>
      `).join('')}
    </div>
  `;

  document.querySelectorAll('.miniWpSlug').forEach((button) => {
    button.addEventListener('click', () => {
      els.wpSlug.value = button.dataset.slug;
      run('wp', `/api/wp/pages?slug=${encodeURIComponent(button.dataset.slug)}`, renderWpPage, 'Fetching WP slug');
    });
  });
}

function renderOpus(payload) {
  if (payload.kind === 'document') {
    renderDocument(payload);
    return;
  }

  const data = payload.data ?? payload.raw ?? payload;
  const cards = normalizeToCards(data);

  if (!cards.length) {
    els.preview.className = 'preview';
    els.preview.innerHTML = `
      <div class="wpPage">
        <p class="eyebrow">Opus response</p>
        <h2>Received data, but no product-like cards were detected</h2>
        <p class="muted">Open Debug JSON below to inspect the exact response shape. The renderer can be adapted once we know the final Opus endpoint structure.</p>
      </div>
    `;
    return;
  }

  els.preview.className = 'preview';
  els.preview.innerHTML = `
    <div class="cards">
      ${cards.map(renderProductCard).join('')}
    </div>
  `;
}

function renderDocument(payload) {
  const url = payload.previewUrl || payload.url;
  els.preview.className = 'preview';
  els.preview.innerHTML = `
    <div class="documentPreview">
      <div class="documentBar">
        <div>
          <p class="eyebrow">Opus document</p>
          <h3>${escapeHtml(payload.title || 'Datasheet / document preview')}</h3>
          <p class="muted">${escapeHtml(payload.contentType || 'document')} · HTTP ${escapeHtml(String(payload.upstreamStatus || payload.status || ''))}</p>
        </div>
        <a class="btn secondary" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">Open document</a>
      </div>
      <iframe class="documentFrame" src="${escapeAttr(url)}" title="Opus document preview"></iframe>
    </div>
  `;
}

function renderProductCard(card) {
  return `
    <article class="contentCard">
      ${card.image ? `<img src="${escapeAttr(card.image)}" alt="${escapeAttr(card.title)}" loading="lazy" />` : ''}
      <div>
        <p class="eyebrow">Opus item${card.sku ? ` · ${escapeHtml(card.sku)}` : ''}</p>
        <h3>${escapeHtml(card.title || 'Untitled item')}</h3>
      </div>
      ${card.description ? `<p>${escapeHtml(card.description)}</p>` : ''}
      ${card.specs?.length ? `<div class="specs">${card.specs.map((spec) => `<div class="spec"><b>${escapeHtml(spec.key)}</b><span>${escapeHtml(spec.value)}</span></div>`).join('')}</div>` : ''}
      ${card.link ? `<a href="${escapeAttr(card.link)}" target="_blank" rel="noreferrer">Open source</a>` : ''}
    </article>
  `;
}

function normalizeToCards(data) {
  const array = findBestObjectArray(data);
  if (!array) {
    if (data && typeof data === 'object' && !Array.isArray(data)) return [normalizeOneCard(data)];
    return [];
  }
  return array.slice(0, 12).map(normalizeOneCard).filter(Boolean);
}

function findBestObjectArray(value, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) return value;
  if (typeof value !== 'object') return null;

  const preferredKeys = ['items', 'products', 'data', 'results', 'records', 'catalog', 'list'];
  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const item of Object.values(value)) {
    const found = findBestObjectArray(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeOneCard(item) {
  if (!item || typeof item !== 'object') return null;
  const title = firstValue(item, ['name', 'title', 'product_name', 'productName', 'displayName', 'label', 'model', 'familyName']) || 'Untitled item';
  const sku = firstValue(item, ['sku', 'code', 'itemCode', 'productCode', 'product_code', 'reference', 'article', 'articleNumber', 'orderCode']);
  const description = stripHtml(firstValue(item, ['description', 'shortDescription', 'short_description', 'overview', 'text', 'body']) || '').slice(0, 260);
  const image = absolutizeUrl(firstImage(item));
  const link = absolutizeUrl(firstValue(item, ['url', 'link', 'href', 'documentUrl', 'datasheetUrl']));
  const specs = Object.entries(flatten(item))
    .filter(([key, value]) => isUsefulSpec(key, value))
    .slice(0, 8)
    .map(([key, value]) => ({ key: humanize(key), value: String(value).slice(0, 80) }));
  return { title: String(title), sku: sku ? String(sku) : '', description, image, link, specs };
}

function firstValue(obj, keys) {
  for (const key of keys) {
    const value = getDeep(obj, key);
    if (isPrimitive(value) && String(value).trim()) return String(value).trim();
  }
  return '';
}

function firstImage(obj) {
  const direct = firstValue(obj, ['image', 'imageUrl', 'image_url', 'thumbnail', 'thumbnailUrl', 'thumbnail_url', 'picture', 'photo']);
  if (direct) return direct;
  const candidates = [obj.images, obj.media, obj.assets, obj.files].filter(Array.isArray).flat();
  for (const item of candidates) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const value = firstValue(item, ['url', 'src', 'href', 'imageUrl', 'downloadUrl']);
      if (value) return value;
    }
  }
  return '';
}

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPrimitive(value)) out[fullKey] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, fullKey, out);
  }
  return out;
}

function isUsefulSpec(key, value) {
  if (!isPrimitive(value) || String(value).trim() === '') return false;
  const lower = key.toLowerCase();
  const blocked = ['id', 'uuid', 'slug', 'name', 'title', 'description', 'url', 'href', 'image', 'thumbnail', 'created', 'updated'];
  return !blocked.some((part) => lower.includes(part));
}

function getDeep(obj, path) {
  if (path.includes('.')) return path.split('.').reduce((acc, key) => acc?.[key], obj);
  return obj?.[path];
}

function isPrimitive(value) {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function absolutizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `https://ideolux.hm-opus.com${url}`;
  return url;
}

function humanize(key) {
  return key
    .split('.')
    .pop()
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || div.innerText || '';
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
  } catch {
    return value;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

els.healthBtn.addEventListener('click', () => run('health', '/api/health', renderHealth, 'Checking'));
els.wpFrontBtn.addEventListener('click', () => run('wp', '/api/wp/frontpage', renderWpPage, 'Fetching WP'));
els.wpSlugBtn.addEventListener('click', () => {
  const slug = els.wpSlug.value.trim();
  run('wp', `/api/wp/pages?slug=${encodeURIComponent(slug)}`, renderWpPage, 'Fetching WP slug');
});
els.wpListBtn.addEventListener('click', () => run('wp', '/api/wp/pages?perPage=9', renderWpList, 'Fetching WP list'));
els.opusFetchBtn.addEventListener('click', () => {
  const url = els.opusUrl.value.trim();
  run('opus', `/api/opus?url=${encodeURIComponent(url)}`, renderOpus, 'Fetching Opus');
});
els.opusSampleBtn.addEventListener('click', () => {
  els.opusUrl.value = SAMPLE_OPUS_URL;
  run('opus', `/api/opus?url=${encodeURIComponent(SAMPLE_OPUS_URL)}`, renderOpus, 'Fetching Opus document');
});
