/**
 * The Nova page shell, for pages rendered by a Function rather than written as a file.
 *
 * IT IS THE SAME PAGE. Same masthead, same wordmark, same footer, same `assets/nova.css` and
 * `assets/nova.js` — the account pages use the classes the static pages already define
 * (`wrap`, `btn`, `btn-primary`, `btn-ghost`, `rise`) rather than bringing a stylesheet of
 * their own. Signing in should feel like a part of the site, not a portal bolted to the side
 * of it, and the cheapest way to guarantee that is to not introduce a second visual language.
 *
 * Everything interpolated into these templates is escaped at the point of interpolation. A
 * sign-in form renders addresses that strangers typed.
 */

export const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const WORDMARK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 .8c.62 6.5 4.7 10.58 11.2 11.2-6.5.62-10.58 4.7-11.2 11.2-.62-6.5-4.7-10.58-11.2-11.2C7.3 11.38 11.38 7.3 12 .8Z" />
      </svg>
      <span>NOVA</span>`;

/**
 * The whole document.
 *
 * `noindex` on every account page: a sign-in form and a person's account are not things for a
 * search engine to hold a copy of.
 */
export function page({ title, lede = '', body, account = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — Nova</title>
<meta name="robots" content="noindex, nofollow" />
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#F5F6FB" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#090B12" media="(prefers-color-scheme: dark)" />
<script>document.documentElement.classList.add("js");</script>
<link rel="stylesheet" href="/assets/nova.css" />
<link rel="stylesheet" href="/assets/account.css" />
</head>
<body>

<a class="skip-link" href="#top">Skip to content</a>

<header class="masthead">
  <div class="wrap masthead-inner">
    <a class="wordmark" href="/" aria-label="Nova — home">${WORDMARK}</a>
    <nav class="masthead-nav" aria-label="Primary">
      <a href="/#featured">Products</a>
      <a href="/ecosystem.html">Ecosystem</a>
      ${accountChip(account)}
    </nav>
  </div>
</header>

<main id="top">
  <section class="account-shell">
    <div class="wrap account-wrap">
      <header class="account-head rise">
        <p class="account-eyebrow">Nova Account</p>
        <h1 class="account-title">${esc(title)}</h1>
        ${lede ? `<p class="account-lede">${esc(lede)}</p>` : ''}
      </header>
      ${body}
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="footer-inner">
      <a class="wordmark" href="/" aria-label="Nova — back to top">${WORDMARK}</a>
      <nav class="footer-links" aria-label="Footer">
        <a href="/ecosystem.html">Ecosystem</a>
        <a href="/#featured">Products</a>
        <a href="https://nova.help/">Support</a>
      </nav>
    </div>
    <div class="footer-legal">
      <span class="footer-legal-links">
        <a href="/terms-of-use.html">Nova Terms of Use</a>
        <i aria-hidden="true">·</i>
        <a href="/terms-of-service.html">Nova Terms of Service</a>
        <i aria-hidden="true">·</i>
        <a href="/privacy.html">Nova Privacy Policy</a>
      </span>
    </div>
  </div>
</footer>

<script src="/assets/nova.js"></script>
</body>
</html>`;
}

/** The masthead control: who you are, or the way to become somebody. */
export function accountChip(account) {
  return account
    ? `<a class="account-chip" href="/account" data-account-chip>${esc(account.displayName || account.email)}</a>`
    : `<a class="account-chip account-chip--guest" href="/account/sign-in" data-account-chip>Sign in</a>`;
}

/* ── Form pieces ─────────────────────────────────────────────────────────────────────────── */

export function field({ id, label, type = 'text', value = '', error, hint, autocomplete, required = true, maxLength }) {
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return `<div class="field${error ? ' field--error' : ''}">
    <label class="field-label" for="${esc(id)}">${esc(label)}</label>
    ${hint ? `<p class="field-hint" id="${esc(id)}-hint">${esc(hint)}</p>` : ''}
    <input
      class="field-input"
      id="${esc(id)}"
      name="${esc(id)}"
      type="${esc(type)}"
      value="${esc(value)}"
      ${required ? 'required' : ''}
      ${maxLength ? `maxlength="${Number(maxLength)}"` : ''}
      ${autocomplete ? `autocomplete="${esc(autocomplete)}"` : ''}
      ${error ? 'aria-invalid="true"' : ''}
      ${described ? `aria-describedby="${esc(described)}"` : ''}
    />
    ${error ? `<p class="field-error" id="${esc(id)}-error">${esc(error)}</p>` : ''}
  </div>`;
}

/** A message above a form. `kind` is 'error' | 'warning' | 'ok'. */
export const notice = (kind, title, body) => `<div class="notice notice--${esc(kind)}" role="status">
  <p class="notice-title">${esc(title)}</p>
  <div class="notice-body">${body}</div>
</div>`;

/**
 * The Google control.
 *
 * DELIBERATELY NOT A LINK AND NOT A FORM. It is a disabled button that posts nowhere and has
 * no route behind it, because a "coming soon" that is secretly wired up is how a half-finished
 * OAuth integration reaches production. When Google sign-in is configured, this becomes a link
 * to the flow Nova.Help already implements in the shared package — the account model does not
 * change, only this control does.
 */
export const googleSoon = () => `<div class="provider-row">
  <button class="btn btn-ghost provider-btn" type="button" disabled aria-disabled="true">
    <svg class="provider-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.74 2.98-4.3 2.98-7.35Z"/>
      <path d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22Z"/>
      <path d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.35-2.59Z"/>
      <path d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.99 14.7 2 12 2a10 10 0 0 0-8.94 5.49l3.35 2.59C7.2 7.72 9.4 5.98 12 5.98Z"/>
    </svg>
    Continue with Google
    <span class="provider-soon">Coming soon</span>
  </button>
</div>
<p class="provider-note">Google sign-in is not available yet. Use an email address and password for now.</p>`;

/** The line that keeps the ecosystem promise honest on every account page. */
export const ecosystemNote = `<p class="account-foot">
  One Nova Account works across Nova, <a href="https://nova.help/">Nova.Help</a>, and every Nova
  product as it arrives. You do not need a separate account for each.
</p>`;

export const html = (markup, { status = 200, headers = {} } = {}) =>
  new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      ...headers,
    },
  });

export const redirect = (location, { headers = {} } = {}) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...headers } });
