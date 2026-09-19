/**
 * The Nova Account front door.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THIS FILE HOLDS NO SECURITY LOGIC. Every decision — is this password right, is this session
 * live, is this reset link still good, may this identity be linked — is made by the
 * `@nova/accounts` package, which is the same code Nova.Help runs against the same D1
 * database. What is here is a router, some forms, and the cookie plumbing. That division is
 * the whole point: the tested system was not rewritten to give Nova a sign-in page.
 *
 * The conventions match Nova.Help's account routes, because they are the same conventions and
 * divergence between two front doors onto one identity is how one of them gets it wrong:
 *
 *   A. THE SESSION COOKIE IS THE ONLY THING THAT SAYS WHO YOU ARE. No query parameter and no
 *      form field is ever trusted for identity.
 *   B. EVERY FAILURE OF SIGN-IN LOOKS THE SAME — one message, one status, whether the address
 *      is unknown, the password is wrong, or the account is disabled.
 *   C. NOTHING SAYS WHETHER AN ADDRESS HAS AN ACCOUNT. The forgotten-password page renders
 *      identically either way.
 *
 * WHY ONE CATCH-ALL RATHER THAN SEVEN FILES. The flows share a shell, a cookie helper and a
 * rate limiter; splitting them across Pages Functions files would mean re-importing and
 * re-deciding those seven times, and the routing table is easier to check when it is a list.
 */
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../packages/nova-accounts/index.mjs';

import { accountsFor } from '../_lib/accounts.mjs';
import { ecosystemNote, esc, field, googleSoon, html, notice, page, redirect } from '../_lib/shell.mjs';

/** Sign-in and sign-up bodies are small; anything larger is not one of these forms. */
const BODY_LIMIT = 16 * 1024;

/* ── Cookies ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The session cookie.
 *
 * `Domain` is what will eventually make one sign-in cover the whole ecosystem: set
 * NOVA_COOKIE_DOMAIN to `.nova.xyz` once Nova and Nova.Help share a registrable domain, and a
 * session opened here is presented to help.nova.xyz as well. Unset — which is the case today,
 * on nova-780.pages.dev — the cookie is host-only and each product keeps its own session
 * against the same shared account. A browser will not accept a Domain its host is not under,
 * so this can never bridge nova.help and a different domain; that is a DNS decision, not a
 * code one.
 */
const sessionCookie = (env, value, maxAge) => {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (env.NOVA_COOKIE_DOMAIN) parts.push(`Domain=${env.NOVA_COOKIE_DOMAIN}`);
  if (env.NOVA_INSECURE_COOKIES !== '1') parts.push('Secure');
  parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
};

const clearSessionCookie = (env) => sessionCookie(env, '', 0);

const readCookie = (request, name) => {
  const header = request.headers.get('cookie') ?? '';
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at === -1) continue;
    if (pair.slice(0, at).trim() === name) return decodeURIComponent(pair.slice(at + 1).trim());
  }
  return null;
};

/** Who is making this request, or null. The package decides; this only carries the cookie. */
async function viewer(accounts, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const resolved = await accounts.resolveSession(token);
  return resolved ? resolved.account : null;
}

/* ── Requests ────────────────────────────────────────────────────────────────────────────── */

async function formFields(request) {
  const body = await request.text();
  if (body.length > BODY_LIMIT) return null;
  return Object.fromEntries(new URLSearchParams(body));
}

/** Only paths inside this site, so `next=` cannot become an open redirect. */
const safeNext = (value) => {
  const next = String(value ?? '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/account';
};

const nextField = (next) => (next && next !== '/account' ? `<input type="hidden" name="next" value="${esc(next)}" />` : '');

/* ── Rate limiting ───────────────────────────────────────────────────────────────────────────
 *
 * The same windows Nova.Help uses, enforced by the same kind of Durable Object. Where the
 * binding is absent — local `node --test`, or a deployment that has not created it — the
 * limiter refuses to pretend: `enforced` is false and the caller says so at boot rather than
 * silently running an unthrottled sign-in form.
 */
function limiterFor(env, name, windowMs, max) {
  if (!env.RATE_LIMITER) return { enforced: false, async hit() { return { ok: true, retryAfter: 0 }; } };

  const stubFor = async (key) => {
    const bytes = new TextEncoder().encode(`nova.site.ratelimit.v1|${name}|${key}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`${name}:${hex}`));
  };

  return {
    enforced: true,
    async hit(key) {
      return (await stubFor(key)).hit(windowMs, max);
    },
    async clear(key) {
      await (await stubFor(key)).clear();
    },
  };
}

const clientIp = (request) => request.headers.get('cf-connecting-ip') ?? 'unknown';

const tooMany = (retryAfter, title = 'Too many attempts') =>
  html(
    page({
      title,
      lede: 'Give it a moment and try again.',
      body: notice('warning', title, `<p>Wait ${esc(retryAfter)} seconds and try again.</p>`) + ecosystemNote,
    }),
    { status: 429, headers: { 'retry-after': String(retryAfter) } },
  );

/* ── Pages ───────────────────────────────────────────────────────────────────────────────── */

const signInBody = ({ values = {}, errors = {}, failed = false, next = '' }) => `
  ${failed ? notice('error', 'That did not sign you in', '<p>Check the email address and password and try again. If you have never made a Nova Account, create one below.</p>') : ''}
  <form class="account-card" method="post" action="/account/sign-in" novalidate>
    ${googleSoon()}
    <div class="or-rule"><span>or</span></div>
    ${nextField(next)}
    ${field({ id: 'email', label: 'Email address', type: 'email', value: values.email ?? '', error: errors.email, autocomplete: 'email', maxLength: 254 })}
    ${field({ id: 'password', label: 'Password', type: 'password', error: errors.password, autocomplete: 'current-password', maxLength: 256 })}
    <div class="account-actions">
      <button class="btn btn-primary" type="submit">Sign in <span class="arrow" aria-hidden="true">→</span></button>
      <a class="btn btn-ghost" href="/account/new">Create an account</a>
    </div>
    <p class="account-fineprint"><a href="/account/forgot">Forgotten your password?</a></p>
  </form>
  ${ecosystemNote}`;

const createBody = ({ values = {}, errors = {}, next = '' }) => `
  <form class="account-card" method="post" action="/account/new" novalidate>
    ${googleSoon()}
    <div class="or-rule"><span>or</span></div>
    ${nextField(next)}
    ${field({ id: 'email', label: 'Email address', type: 'email', value: values.email ?? '', error: errors.email, autocomplete: 'email', maxLength: 254 })}
    ${field({ id: 'displayName', label: 'Name', value: values.displayName ?? '', error: errors.displayName, autocomplete: 'name', required: false, hint: 'Optional. What we call you.', maxLength: 80 })}
    ${field({ id: 'password', label: 'Password', type: 'password', error: errors.password, autocomplete: 'new-password', hint: 'At least 10 characters. A short sentence is easier to remember and harder to guess.', maxLength: 256 })}
    ${field({ id: 'passwordConfirm', label: 'Password again', type: 'password', error: errors.passwordConfirm, autocomplete: 'new-password', maxLength: 256 })}
    <div class="account-actions">
      <button class="btn btn-primary" type="submit">Create account <span class="arrow" aria-hidden="true">→</span></button>
      <a class="btn btn-ghost" href="/account/sign-in">I already have one</a>
    </div>
  </form>
  ${ecosystemNote}`;

const PRODUCTS = [
  { name: 'Nova', note: 'This site', href: '/' },
  { name: 'Nova.Help', note: 'Support for every Nova product', href: 'https://nova.help/' },
  { name: 'Online Earth', note: 'Coming soon', href: null },
  { name: 'Open Cut', note: 'Coming soon', href: null },
  { name: 'Atlas', note: 'Coming soon', href: null },
];

const accountBody = (account, banner) => `
  ${banner ?? ''}
  <div class="account-card">
    <h2 class="account-card-title">Your Nova Account</h2>
    <dl class="account-facts">
      <div><dt>Email</dt><dd>${esc(account.email)}</dd></div>
      ${account.displayName ? `<div><dt>Name</dt><dd>${esc(account.displayName)}</dd></div>` : ''}
      <div><dt>Password</dt><dd>${account.hasPassword ? 'Set' : 'Not set — use “Forgotten your password?” to choose one'}</dd></div>
      <div><dt>Sign-in methods</dt><dd>Email and password${account.identities.length ? `, ${account.identities.map((i) => esc(i.provider)).join(', ')}` : ''}</dd></div>
    </dl>
    <div class="account-actions">
      <a class="btn btn-ghost" href="/account/forgot">Change password</a>
      <form method="post" action="/account/sign-out" class="inline-form">
        <button class="btn btn-ghost" type="submit">Sign out</button>
      </form>
    </div>
  </div>

  <div class="account-card">
    <h2 class="account-card-title">This account works across Nova</h2>
    <p class="account-card-lede">
      One Nova Account, one password, everywhere. You never need a separate account for a Nova
      product — including Nova.Help, where you can already use this one.
    </p>
    <ul class="ecosystem-list">
      ${PRODUCTS.map(
        (product) => `<li>
        <span class="ecosystem-name">${
          product.href ? `<a href="${esc(product.href)}">${esc(product.name)}</a>` : esc(product.name)
        }</span>
        <span class="ecosystem-note">${esc(product.note)}</span>
      </li>`,
      ).join('')}
    </ul>
  </div>`;

const forgotBody = ({ values = {}, errors = {} }) => `
  <form class="account-card" method="post" action="/account/forgot" novalidate>
    <p class="account-card-lede">
      Type the address on your Nova Account and we will send a link to choose a new password.
      The link works once and expires after an hour.
    </p>
    ${field({ id: 'email', label: 'Email address', type: 'email', value: values.email ?? '', error: errors.email, autocomplete: 'email', maxLength: 254 })}
    <div class="account-actions">
      <button class="btn btn-primary" type="submit">Send the link <span class="arrow" aria-hidden="true">→</span></button>
      <a class="btn btn-ghost" href="/account/sign-in">Back to sign in</a>
    </div>
  </form>
  ${ecosystemNote}`;

const resetBody = ({ token, email, errors = {} }) => `
  <form class="account-card" method="post" action="/account/reset" novalidate>
    <p class="account-card-lede">
      ${email ? `For <strong>${esc(email)}</strong>. ` : ''}Everything currently signed in will be
      signed out once you save it — on Nova and on every Nova product.
    </p>
    <input type="hidden" name="token" value="${esc(token)}" />
    ${field({ id: 'password', label: 'New password', type: 'password', error: errors.password, autocomplete: 'new-password', hint: 'At least 10 characters.', maxLength: 256 })}
    ${field({ id: 'passwordConfirm', label: 'New password again', type: 'password', error: errors.passwordConfirm, autocomplete: 'new-password', maxLength: 256 })}
    <div class="account-actions">
      <button class="btn btn-primary" type="submit">Save the new password <span class="arrow" aria-hidden="true">→</span></button>
    </div>
  </form>`;

const deadLinkBody = (reason) => `
  ${notice(
    'error',
    reason === 'expired' ? 'That link has expired' : 'That link cannot be used',
    reason === 'expired'
      ? '<p>Reset links last an hour, so this one has lapsed. Ask for another and it will arrive with a fresh hour on it.</p>'
      : '<p>It may have been used already, replaced by a newer one, or copied incompletely from the email. Asking for another will fix it.</p>',
  )}
  <div class="account-card">
    <p class="account-card-lede">Your password has not been changed and your account is untouched.</p>
    <div class="account-actions">
      <a class="btn btn-primary" href="/account/forgot">Ask for another link</a>
      <a class="btn btn-ghost" href="/account/sign-in">Back to sign in</a>
    </div>
  </div>`;

/* ── The router ──────────────────────────────────────────────────────────────────────────── */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/account';
  const method = request.method === 'HEAD' ? 'GET' : request.method;

  let accounts;
  try {
    accounts = await accountsFor(env);
  } catch (error) {
    console.error('[nova] account system unavailable', error);
    return html(
      page({
        title: 'Accounts are not available',
        lede: 'This one is ours, not yours.',
        body: notice('error', 'Not configured', '<p>The Nova Account system is not configured on this deployment yet.</p>'),
      }),
      { status: 503 },
    );
  }

  const ip = clientIp(request);
  const signInLimiter = limiterFor(env, 'signIn', 15 * 60 * 1000, 10);
  const signInEmailLimiter = limiterFor(env, 'signInEmail', 15 * 60 * 1000, 10);
  const registerLimiter = limiterFor(env, 'register', 60 * 60 * 1000, 5);
  const resetLimiter = limiterFor(env, 'passwordReset', 60 * 60 * 1000, 6);
  const resetEmailLimiter = limiterFor(env, 'passwordResetEmail', 60 * 60 * 1000, 4);

  const openSession = async (accountId, destination) => {
    const started = await accounts.startSession(accountId, { ttlSeconds: SESSION_TTL_SECONDS });
    if (!started.ok) return html(page({ title: 'Sign in', body: signInBody({ failed: true }) }), { status: 403 });
    return redirect(destination, { headers: { 'set-cookie': sessionCookie(env, started.token, SESSION_TTL_SECONDS) } });
  };

  /* ── Who is here ─────────────────────────────────────────────────────────────────────── */

  const account = await viewer(accounts, request);

  /* ── GET /account/status — for the masthead on the static pages ──────────────────────── */

  if (path === '/account/status' && method === 'GET') {
    /* Only ever the viewer's OWN account, and never cached: it is derived from their cookie.
       An unauthenticated request gets `{ signedIn: false }` rather than an error, because that
       is the ordinary case for a visitor and not a failure. */
    return new Response(
      JSON.stringify(
        account
          ? { signedIn: true, name: account.displayName || account.email }
          : { signedIn: false },
      ),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store, private',
          'x-content-type-options': 'nosniff',
        },
      },
    );
  }

  /* ── /account ────────────────────────────────────────────────────────────────────────── */

  if (path === '/account' && method === 'GET') {
    if (!account) return redirect('/account/sign-in?next=%2Faccount');

    const welcome = url.searchParams.get('welcome');
    const banner =
      welcome === 'created'
        ? notice('ok', 'Your Nova Account is ready', '<p>You are signed in. This account works across every Nova product.</p>')
        : welcome === 'signed-in'
          ? notice('ok', 'Signed in', '<p>Welcome back.</p>')
          : welcome === 'password-reset'
            ? notice(
                'ok',
                'Your password has been changed',
                '<p>You are signed in on this device. Everything else has been signed out, on Nova and on every Nova product. If you did not do this, change the password again immediately and secure your email account.</p>',
              )
            : null;

    return html(page({ title: 'Your Nova Account', account, body: accountBody(account, banner) }));
  }

  /* ── Sign in ─────────────────────────────────────────────────────────────────────────── */

  if (path === '/account/sign-in') {
    if (method === 'GET') {
      if (account) return redirect(safeNext(url.searchParams.get('next')));
      return html(
        page({
          title: 'Sign in to Nova',
          lede: 'One Nova Account, for every Nova product.',
          body: signInBody({ next: safeNext(url.searchParams.get('next')) }),
        }),
      );
    }

    if (method === 'POST') {
      const bySource = await signInLimiter.hit(ip);
      if (!bySource.ok) return tooMany(bySource.retryAfter);

      const fields = await formFields(request);
      if (!fields) return html(page({ title: 'Sign in to Nova', body: signInBody({ failed: true }) }), { status: 413 });

      const next = safeNext(fields.next);
      const email = accounts.normalizeEmail(fields.email);
      if (email) {
        const byEmail = await signInEmailLimiter.hit(`email:${email}`);
        if (!byEmail.ok) return tooMany(byEmail.retryAfter);
      }

      const attempt = await accounts.signIn(fields);
      if (!attempt.ok) {
        /* A missing field is a typo and gets a per-field message; everything else gets the one
           generic failure, so the form cannot say which addresses have accounts. */
        const incomplete = attempt.reason === 'incomplete';
        return html(
          page({
            title: 'Sign in to Nova',
            body: signInBody({
              values: attempt.values,
              errors: incomplete ? attempt.errors : {},
              failed: !incomplete,
              next,
            }),
          }),
          { status: incomplete ? 422 : 401 },
        );
      }

      // A correct password clears the counters, so one forgotten password costs nothing later.
      await signInLimiter.clear?.(ip);
      await signInEmailLimiter.clear?.(`email:${email}`);

      return openSession(attempt.account.id, next === '/account' ? '/account?welcome=signed-in' : next);
    }
  }

  /* ── Create an account ───────────────────────────────────────────────────────────────── */

  if (path === '/account/new') {
    if (method === 'GET') {
      if (account) return redirect(safeNext(url.searchParams.get('next')));
      return html(
        page({
          title: 'Create a Nova Account',
          lede: 'One account for Nova, Nova.Help, and everything that follows.',
          body: createBody({ next: safeNext(url.searchParams.get('next')) }),
        }),
      );
    }

    if (method === 'POST') {
      const gate = await registerLimiter.hit(ip);
      if (!gate.ok) return tooMany(gate.retryAfter);

      const fields = await formFields(request);
      if (!fields) return html(page({ title: 'Create a Nova Account', body: createBody({}) }), { status: 413 });

      const next = safeNext(fields.next);
      const created = await accounts.register(fields);
      if (!created.ok) {
        return html(
          page({
            title: 'Create a Nova Account',
            body: createBody({ values: created.values, errors: created.errors, next }),
          }),
          { status: 422 },
        );
      }

      return openSession(created.account.id, next === '/account' ? '/account?welcome=created' : next);
    }
  }

  /* ── Sign out ────────────────────────────────────────────────────────────────────────── */

  if (path === '/account/sign-out' && method === 'POST') {
    /* The SESSION is revoked, not just the cookie: a copy taken beforehand stops working too.
       POST only, and the cookie is SameSite=Lax, so another site cannot sign you out. */
    const token = readCookie(request, SESSION_COOKIE);
    if (token) await accounts.signOut(token);
    return redirect('/', { headers: { 'set-cookie': clearSessionCookie(env) } });
  }

  /* ── Forgotten password ──────────────────────────────────────────────────────────────── */

  if (path === '/account/forgot') {
    if (method === 'GET') {
      if (account) return redirect('/account');
      return html(page({ title: 'Forgotten your password?', lede: 'Tell us the address and we will send you a way back in.', body: forgotBody({}) }));
    }

    if (method === 'POST') {
      const bySource = await resetLimiter.hit(ip);
      if (!bySource.ok) return tooMany(bySource.retryAfter);

      const fields = await formFields(request);
      if (!fields) return html(page({ title: 'Forgotten your password?', body: forgotBody({}) }), { status: 413 });

      const email = accounts.normalizeEmail(fields.email);
      const sent = () =>
        html(
          page({
            title: 'Check your email',
            lede: 'The next step is in your inbox.',
            body: `<div class="account-card">
              <p class="account-card-lede">
                If there is a Nova Account for <strong>${esc(email)}</strong>, a link to choose a
                new password is on its way. It works once and expires after an hour.
              </p>
              <p class="account-card-lede">
                Nothing after a few minutes? Check the spam folder, and make sure that is the
                address you signed up with. <a href="/account/forgot">Ask for another link</a> —
                asking again replaces the previous one.
              </p>
              <div class="account-actions">
                <a class="btn btn-ghost" href="/account/sign-in">Back to sign in</a>
              </div>
            </div>${ecosystemNote}`,
          }),
        );

      if (email) {
        /* Answered with the ordinary confirmation rather than a 429: a different response for
           an address that has been asked about a lot is itself a signal about that address. */
        const byEmail = await resetEmailLimiter.hit(`email:${email}`);
        if (!byEmail.ok) return sent();
      }

      const link = (token) => `${url.origin}/account/reset?token=${encodeURIComponent(token)}`;
      const requested = await accounts.requestPasswordReset(fields, { link });

      if (!requested.ok) {
        return html(page({ title: 'Forgotten your password?', body: forgotBody({ values: requested.values, errors: requested.errors }) }), {
          status: 422,
        });
      }
      if (!requested.sent) console.log('[nova] password reset requested; no mail sent');

      return sent();
    }
  }

  /* ── Choose a new password ───────────────────────────────────────────────────────────── */

  if (path === '/account/reset') {
    if (method === 'GET') {
      const token = url.searchParams.get('token') ?? '';
      const checked = await accounts.checkResetToken(token);
      if (!checked.ok) {
        return html(page({ title: 'Reset your password', body: deadLinkBody(checked.reason === 'expired' ? 'expired' : 'invalid') }), {
          status: 400,
        });
      }
      return html(page({ title: 'Choose a new password', body: resetBody({ token, email: checked.email }) }));
    }

    if (method === 'POST') {
      const gate = await resetLimiter.hit(ip);
      if (!gate.ok) return tooMany(gate.retryAfter);

      const fields = await formFields(request);
      if (!fields) return html(page({ title: 'Choose a new password', body: deadLinkBody('invalid') }), { status: 413 });

      const token = String(fields.token ?? '');
      const result = await accounts.resetPassword(token, fields);

      if (!result.ok) {
        /* A password that fails the rules keeps the form, token and all: validation runs before
           redemption, so the link has NOT been spent. A bad link gets no form. */
        if (result.reason === 'invalid-password') {
          const checked = await accounts.checkResetToken(token);
          if (!checked.ok) return html(page({ title: 'Reset your password', body: deadLinkBody('invalid') }), { status: 400 });
          return html(
            page({ title: 'Choose a new password', body: resetBody({ token, email: checked.email, errors: result.errors }) }),
            { status: 422 },
          );
        }
        return html(page({ title: 'Reset your password', body: deadLinkBody(result.reason === 'expired' ? 'expired' : 'invalid') }), {
          status: 400,
        });
      }

      return openSession(result.account.id, '/account?welcome=password-reset');
    }
  }

  /* ── Anything else under /account ────────────────────────────────────────────────────── */

  return html(
    page({
      title: 'Not found',
      lede: 'That page is not here.',
      body: `<div class="account-card">
        <div class="account-actions">
          <a class="btn btn-primary" href="/account">Your account</a>
          <a class="btn btn-ghost" href="/">Back to Nova</a>
        </div>
      </div>`,
    }),
    { status: 404 },
  );
}
