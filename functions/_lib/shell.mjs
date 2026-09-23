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

const SOCIAL = `<span class="masthead-lang" data-nova-lang-slot></span>
      <span class="masthead-social">
        <a href="https://discord.gg/XBhER9Z6EB" rel="noopener" class="social-link" aria-label="Nova on Discord" title="Discord"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg></a>
        <a href="https://github.com/17sh8dy?tab=repositories" rel="noopener" class="social-link" aria-label="Nova on GitHub" title="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>
      </span>`;

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
<script src="/assets/nova-i18n-boot.js"></script>
<link rel="stylesheet" href="/assets/nova-i18n.css" />
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
      ${SOCIAL}
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
        <a href="https://nova-help.shadylabs.workers.dev/">Support</a>
        <a href="https://discord.gg/XBhER9Z6EB" rel="noopener">Discord</a>
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
<script src="/assets/hold-button.js"></script>
<script src="/assets/nova-i18n.js" data-base="/i18n/" defer></script>
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
  One Nova Account works across Nova, <a href="https://nova-help.shadylabs.workers.dev/">Nova.Help</a>, and every Nova
  product as it arrives. You do not need a separate account for each.
</p>`;

/**
 * `setCookies`: a Response's `headers` init only holds ONE value per key, so a plain
 * `headers: { 'set-cookie': a }` object can never carry both the session cookie and the
 * cross-origin status-ping cookie (see [[path]].mjs's `statusCookie`) on the same response —
 * whichever was assigned last would silently win and the other would never reach the browser.
 * `.headers.append()` on the constructed Response is the one way to emit two real, separate
 * `Set-Cookie` lines (never comma-join cookies: `Expires` contains a comma).
 */
const withCookies = (response, setCookies) => {
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
};

export const html = (markup, { status = 200, headers = {}, setCookies = [] } = {}) =>
  withCookies(
    new Response(markup, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        ...headers,
      },
    }),
    setCookies,
  );

export const redirect = (location, { headers = {}, setCookies = [] } = {}) =>
  withCookies(
    new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...headers } }),
    setCookies,
  );
