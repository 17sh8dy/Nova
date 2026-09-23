/**
 * Managing a Nova Account: profile, picture, email, password, security, and deletion.
 *
 * APPS SHOW WHO YOU ARE; NOVA CHANGES IT. Atlas and the other products display an identity and
 * can sign you out. Everything below happens here, in one place, so there is one page to trust
 * with a password and one flow to secure -- not a copy in every product.
 *
 * THIS FILE HOLDS NO SECURITY DECISIONS EITHER. Like the router it plugs into, it renders
 * pages and carries requests; whether a password is right, whether an address is taken,
 * whether a picture is a real picture, and what deletion removes are decided by `@nova/accounts`
 * (and `tickets.mjs` for the one thing that package must not know about).
 *
 * THE RULES EVERY ROUTE HERE FOLLOWS:
 *
 *   1. IDENTITY IS THE SESSION COOKIE, and only that. The router resolved it; no field in a body
 *      or a query string ever names an account.
 *   2. STATE CHANGES ARE POST-ONLY, behind a `SameSite=Lax` cookie, which is the same CSRF
 *      stance the rest of the account pages take. A GET never changes anything.
 *   3. THE PASSWORD IS ASKED FOR AGAIN before an address change, a password change, or a
 *      deletion. A stolen cookie alone is not enough to take the account or destroy it.
 *   4. THOSE THREE ARE RATE-LIMITED PER ACCOUNT, because they are password-guessing surfaces
 *      for anyone who has a session.
 *   5. NOTHING IS ECHOED BACK THAT WAS A PASSWORD.
 */
import { AVATAR_LIMITS, validateAvatar } from '../../packages/nova-accounts/index.mjs';

import { available as avatarsAvailable, avatarResponse, purgeAvatars, removeAvatar, saveAvatar } from './avatars.mjs';
import { ecosystemNote, esc, field, html, notice, page, redirect } from './shell.mjs';
import { anonymiseTicketsFor } from './tickets.mjs';

const BODY_LIMIT = 16 * 1024;
/** A picture plus multipart framing. Checked from the header BEFORE the body is read. */
const UPLOAD_LIMIT = AVATAR_LIMITS.maxBytes + 16 * 1024;

const formFields = async (request) => {
  const body = await request.text();
  if (body.length > BODY_LIMIT) return null;
  return Object.fromEntries(new URLSearchParams(body));
};

const asString = (value) => (typeof value === 'string' ? value : '');

/* ── Shared pieces ───────────────────────────────────────────────────────────────────────── */

const SECTIONS = [
  { path: '/account', label: 'Overview' },
  { path: '/account/profile', label: 'Profile' },
  { path: '/account/email', label: 'Email' },
  { path: '/account/password', label: 'Password' },
  { path: '/account/security', label: 'Security' },
  { path: '/account/delete', label: 'Delete account', danger: true },
];

/** The navigation between management pages. `current` is the path being shown. */
export const manageNav = (current) => `<nav class="account-nav" aria-label="Account settings">
  ${SECTIONS.map(
    (section) =>
      `<a href="${section.path}"${section.path === current ? ' aria-current="page"' : ''}${section.danger ? ' class="is-danger"' : ''}>${esc(section.label)}</a>`,
  ).join('')}
</nav>`;

const submit = (label) => `<div class="account-actions">
  <button class="btn btn-primary" type="submit">${esc(label)} <span class="arrow" aria-hidden="true">→</span></button>
</div>`;

/** The avatar, or a letter in a circle when there is none. `reference` is the stored row. */
export const avatarBadge = (account, reference, { size = 'md' } = {}) => {
  if (reference) {
    return `<img class="account-avatar account-avatar--${size}" src="/account/avatar?v=${encodeURIComponent(reference.updatedAt ?? '')}" alt="Your profile picture" width="96" height="96" />`;
  }
  const initial = [...String(account.displayName || account.email || '?')][0].toUpperCase();
  return `<span class="account-avatar account-avatar--${size} account-avatar--none" aria-hidden="true">${esc(initial)}</span>`;
};

const DONE = {
  name: 'Your name has been saved.',
  avatar: 'Your profile picture has been changed.',
  'avatar-removed': 'Your profile picture has been removed.',
  password: 'Your password has been changed. Every other device has been signed out.',
  'signed-out-others': 'Every other device has been signed out.',
  revoked: 'That sign-in has been ended.',
};

const doneBanner = (url) => {
  const message = DONE[url.searchParams.get('done')];
  return message ? notice('ok', message, '') : '';
};

const shellFor = (title, current, account, body, lede = '') =>
  page({ title, lede, account, body: `${manageNav(current)}${body}` });

/* ── Profile ─────────────────────────────────────────────────────────────────────────────── */

const profileBody = ({ account, reference, canUpload, url, errors = {}, values = {}, uploadError = '' }) => `
  ${doneBanner(url)}
  <div class="account-card">
    <h2 class="account-card-title">Profile picture</h2>
    <div class="avatar-row">
      ${avatarBadge(account, reference, { size: 'lg' })}
      ${
        canUpload
          ? `<div class="avatar-controls">
        <form method="post" action="/account/avatar" enctype="multipart/form-data" class="avatar-form" novalidate>
          ${uploadError ? `<p class="field-error" role="alert">${esc(uploadError)}</p>` : ''}
          <label class="field-label" for="avatar">Choose a picture</label>
          <p class="field-hint" id="avatar-hint">PNG, JPEG or WebP, up to ${AVATAR_LIMITS.maxBytes / 1024} KB. It is shrunk to fit before it is sent.</p>
          <input class="field-input" id="avatar" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="avatar-hint" data-avatar-input />
          <div class="account-actions">
            <button class="btn btn-primary" type="submit">Upload <span class="arrow" aria-hidden="true">→</span></button>
          </div>
        </form>
        ${
          reference
            ? `<form method="post" action="/account/avatar/remove" class="inline-form">
          <button class="btn btn-ghost" type="submit">Remove picture</button>
        </form>`
            : ''
        }
        <script src="/assets/account-avatar.js" defer></script>
      </div>`
          : `<div class="avatar-controls">${notice('warning', 'Profile pictures are not available yet', '<p>They will appear here once they are switched on for this site.</p>')}</div>`
      }
    </div>
  </div>

  <form class="account-card" method="post" action="/account/profile" novalidate>
    <h2 class="account-card-title">Name</h2>
    ${field({ id: 'displayName', label: 'Name', value: values.displayName ?? account.displayName ?? '', error: errors.displayName, autocomplete: 'name', required: false, hint: 'What we call you. Optional.', maxLength: 80 })}
    ${submit('Save name')}
  </form>`;

/* ── Email ───────────────────────────────────────────────────────────────────────────────── */

const emailBody = ({ account, errors = {}, values = {} }) => `
  <form class="account-card" method="post" action="/account/email" novalidate>
    <p class="account-card-lede">
      Your address is <strong>${esc(account.email)}</strong>. Changing it changes what you sign in
      with, on every Nova product. We will tell the old address that it was changed.
    </p>
    ${
      account.hasPassword
        ? `${field({ id: 'newEmail', label: 'New email address', type: 'email', value: values.newEmail ?? '', error: errors.newEmail, autocomplete: 'email', maxLength: 254 })}
    ${field({ id: 'currentPassword', label: 'Current password', type: 'password', error: errors.currentPassword, autocomplete: 'current-password', hint: 'To make sure it is you.', maxLength: 256 })}
    ${submit('Change email')}`
        : noPasswordNote
    }
  </form>`;

const noPasswordNote = notice(
  'warning',
  'This account has no password yet',
  '<p>Changing it needs one. Use <a href="/account/forgot">Forgotten your password?</a> to choose one first.</p>',
);

/* ── Password ────────────────────────────────────────────────────────────────────────────── */

const passwordBody = ({ account, errors = {} }) => `
  <form class="account-card" method="post" action="/account/password" novalidate>
    <p class="account-card-lede">
      Everything else that is signed in — every browser and every Nova product — will be signed
      out when you save. This device stays signed in.
    </p>
    ${
      account.hasPassword
        ? `${field({ id: 'currentPassword', label: 'Current password', type: 'password', error: errors.currentPassword, autocomplete: 'current-password', maxLength: 256 })}
    ${field({ id: 'password', label: 'New password', type: 'password', error: errors.password, autocomplete: 'new-password', hint: 'At least 10 characters. A short sentence is easier to remember and harder to guess.', maxLength: 256 })}
    ${field({ id: 'passwordConfirm', label: 'New password again', type: 'password', error: errors.passwordConfirm, autocomplete: 'new-password', maxLength: 256 })}
    ${submit('Change password')}
    <p class="account-fineprint"><a href="/account/forgot">Forgotten your current password?</a></p>`
        : noPasswordNote
    }
  </form>`;

/* ── Security ────────────────────────────────────────────────────────────────────────────── */

const day = (iso) => String(iso ?? '').slice(0, 10);

const securityBody = ({ account, sessions, url }) => `
  ${doneBanner(url)}
  <div class="account-card">
    <h2 class="account-card-title">Where you are signed in</h2>
    <p class="account-card-lede">Every browser and app that is signed in to this account. If you do not recognise one, end it and change your password.</p>
    <ul class="session-list">
      ${sessions
        .map(
          (session) => `<li class="session${session.current ? ' session--current' : ''}">
        <div>
          <p class="session-name">${esc(session.kind === 'device' ? `${session.label || session.product || 'An app'} (app)` : `${session.product === 'nova.help' ? 'Nova.Help' : 'Nova'} in a browser`)}${session.current ? ' <span class="session-badge">This device</span>' : ''}</p>
          <p class="session-meta">Signed in ${esc(day(session.createdAt))} · expires ${esc(day(session.expiresAt))}</p>
        </div>
        ${
          session.current
            ? ''
            : `<form method="post" action="/account/security/revoke" class="inline-form">
          <input type="hidden" name="sessionId" value="${esc(session.id)}" />
          <button class="btn btn-ghost" type="submit">End</button>
        </form>`
        }
      </li>`,
        )
        .join('')}
    </ul>
    ${
      sessions.length > 1
        ? `<form method="post" action="/account/security/sign-out-others" class="inline-form">
      <button class="btn btn-ghost" type="submit">Sign out everywhere else</button>
    </form>`
        : ''
    }
  </div>

  <div class="account-card">
    <h2 class="account-card-title">How you sign in</h2>
    <dl class="account-facts">
      <div><dt>Password</dt><dd>${account.hasPassword ? 'Set — <a href="/account/password">change it</a>' : 'Not set — <a href="/account/forgot">choose one</a>'}</dd></div>
      <div><dt>Email</dt><dd>${esc(account.email)} — <a href="/account/email">change it</a></dd></div>
      <div><dt>Google</dt><dd>${account.identities.some((i) => i.provider === 'google') ? 'Linked' : 'Not available yet'}</dd></div>
      <div><dt>Two-step verification</dt><dd>Not available yet</dd></div>
    </dl>
    <p class="account-fineprint">We will add the last two here as they are built. Nothing on this page pretends they exist.</p>
  </div>`;

/* ── Delete ──────────────────────────────────────────────────────────────────────────────── */

const deleteBody = ({ account, errors = {} }) => `
  ${notice('warning', 'This cannot be undone', '<p>There is no grace period and no way to get an account back.</p>')}
  <form class="account-card account-card--danger" method="post" action="/account/delete" novalidate>
    <h2 class="account-card-title">What deleting removes</h2>
    <ul class="account-list">
      <li>Your Nova Account, and your sign-in on <strong>every</strong> Nova product, on every device.</li>
      <li>Your profile picture and your name.</li>
      <li>Anything a Nova product saved to your account.</li>
    </ul>
    <h2 class="account-card-title">What is kept</h2>
    <ul class="account-list">
      <li>Your <strong>Nova.Help tickets</strong> stay, so the support history is not lost — but your name, email address and IP address are removed from them and they are no longer linked to you. Anything you wrote in a ticket stays as you wrote it.</li>
    </ul>
    ${
      account.hasPassword
        ? `${field({ id: 'confirmEmail', label: `Type ${account.email} to confirm`, type: 'email', error: errors.confirmEmail, autocomplete: 'off', maxLength: 254 })}
    ${field({ id: 'currentPassword', label: 'Current password', type: 'password', error: errors.currentPassword, autocomplete: 'current-password', maxLength: 256 })}
    <label class="check"><input type="checkbox" name="understand" value="yes" required /> I understand this is permanent.</label>
    ${errors.understand ? `<p class="field-error" role="alert">${esc(errors.understand)}</p>` : ''}
    <div class="account-actions">
      <button
        class="btn btn-danger hold-btn"
        type="submit"
        data-hold-button
        data-hold-armed-label="Deleting your account…"
        aria-describedby="delete-hold-status"
      ><span class="hold-btn__fill" data-hold-fill aria-hidden="true"></span><span class="hold-btn__label" data-hold-label>Hold to permanently delete my account</span></button>
      <a class="btn btn-ghost" href="/account">Keep my account</a>
      <p class="visually-hidden" id="delete-hold-status" role="status" aria-live="polite" data-hold-status></p>
    </div>`
        : noPasswordNote
    }
  </form>`;

const deletedPage = () =>
  html(
    page({
      title: 'Your account has been deleted',
      lede: 'It is gone from every Nova product.',
      body: `${notice('ok', 'Deleted', '<p>Your account, its sign-ins and your profile picture have been removed. Your support tickets were kept but no longer name you. We have sent a confirmation to the address that was on the account.</p>')}
      <div class="account-card"><div class="account-actions"><a class="btn btn-primary" href="/">Back to Nova</a></div></div>`,
    }),
  );

/* ── The router ──────────────────────────────────────────────────────────────────────────── */

/**
 * Handle a request if it is one of the management routes; otherwise return null so the caller
 * carries on. `ctx` carries what only the account router owns: the viewer, the current session
 * token, the rate limiter, and the cookie helper.
 */
export async function handleManage(ctx) {
  const { request, env, url, path, method, accounts, account, token, limiterFor, tooMany, clearSessionCookie, clearStatusCookie } = ctx;

  if (path === '/account/deleted' && method === 'GET') return deletedPage();

  const mine = [
    '/account/profile', '/account/avatar', '/account/avatar/remove', '/account/email', '/account/password',
    '/account/security', '/account/security/sign-out-others', '/account/security/revoke', '/account/delete',
  ];
  if (!mine.includes(path)) return null;

  if (!account) return redirect(`/account/sign-in?next=${encodeURIComponent(method === 'GET' ? path : '/account')}`);

  const guard = limiterFor(env, 'manage', 15 * 60 * 1000, 10);
  const limited = async () => {
    const hit = await guard.hit(account.id);
    return hit.ok ? null : tooMany(hit.retryAfter);
  };
  const bad = (title, current, body, status = 400) => html(shellFor(title, current, account, body), { status });

  /* ── Profile: name ───────────────────────────────────────────────────────────────────── */

  if (path === '/account/profile') {
    const canUpload = avatarsAvailable(env);
    const reference = await accounts.getAvatar(account.id);

    if (method === 'GET') {
      return html(shellFor('Profile', path, account, profileBody({ account, reference, canUpload, url })));
    }
    if (method === 'POST') {
      const fields = await formFields(request);
      if (!fields) return html(shellFor('Profile', path, account, notice('error', 'That was too large', '')), { status: 413 });
      const result = await accounts.updateProfile(account.id, { displayName: fields.displayName });
      if (!result.ok) {
        return bad('Profile', path, profileBody({ account, reference, canUpload, url, errors: result.errors ?? {}, values: result.values ?? {} }));
      }
      return redirect('/account/profile?done=name');
    }
  }

  /* ── Profile: picture ────────────────────────────────────────────────────────────────── */

  if (path === '/account/avatar' && method === 'GET') {
    const reference = await accounts.getAvatar(account.id);
    const response = await avatarResponse(env, reference, account.id);
    return response ?? new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (path === '/account/avatar' && method === 'POST') {
    if (!avatarsAvailable(env)) {
      return html(shellFor('Profile', '/account/profile', account, notice('error', 'Profile pictures are not available', '')), { status: 503 });
    }
    const reference = await accounts.getAvatar(account.id);
    const again = (message, status = 400) =>
      html(shellFor('Profile', '/account/profile', account, profileBody({ account, reference, canUpload: true, url, uploadError: message })), { status });

    // The size is refused from the header before a byte of the body is read.
    const declared = Number(request.headers.get('content-length'));
    if (!Number.isFinite(declared) || declared <= 0 || declared > UPLOAD_LIMIT) {
      return again(`That picture is too large. Use one under ${AVATAR_LIMITS.maxBytes / 1024} KB.`, 413);
    }

    let file;
    try {
      file = (await request.formData()).get('avatar');
    } catch {
      return again('That upload could not be read.');
    }
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return again('Choose a picture to upload.');

    // What the browser CLAIMS the file is (`file.type`, `file.name`) is never consulted.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateAvatar(bytes);
    if (!checked.ok) return again(checked.error);

    const saved = await saveAvatar({ env, accounts, accountId: account.id, bytes, image: checked.image });
    if (!saved.ok) return again('We could not save that picture. Nothing was changed. Please try again.', 500);
    return redirect('/account/profile?done=avatar');
  }

  if (path === '/account/avatar/remove' && method === 'POST') {
    await removeAvatar({ env, accounts, accountId: account.id });
    return redirect('/account/profile?done=avatar-removed');
  }

  /* ── Email ───────────────────────────────────────────────────────────────────────────── */

  if (path === '/account/email') {
    if (method === 'GET') return html(shellFor('Change email', path, account, emailBody({ account })));
    if (method === 'POST') {
      const fields = await formFields(request);
      if (!fields) return bad('Change email', path, emailBody({ account, errors: { newEmail: 'That was too large.' } }), 413);
      const wait = await limited();
      if (wait) return wait;

      const result = await accounts.changeEmail(account.id, { newEmail: fields.newEmail, currentPassword: asString(fields.currentPassword) });
      if (!result.ok) {
        const status = result.reason === 'wrong-password' ? 403 : 400;
        return bad('Change email', path, emailBody({ account, errors: result.errors ?? {}, values: result.values ?? {} }), status);
      }
      return redirect('/account?updated=email');
    }
  }

  /* ── Password ────────────────────────────────────────────────────────────────────────── */

  if (path === '/account/password') {
    if (method === 'GET') return html(shellFor('Change password', path, account, passwordBody({ account })));
    if (method === 'POST') {
      const fields = await formFields(request);
      if (!fields) return bad('Change password', path, passwordBody({ account, errors: { password: 'That was too large.' } }), 413);
      const wait = await limited();
      if (wait) return wait;

      const result = await accounts.changePassword(
        account.id,
        { currentPassword: asString(fields.currentPassword), password: asString(fields.password), passwordConfirm: asString(fields.passwordConfirm) },
        { keepToken: token },
      );
      if (!result.ok) {
        const status = result.reason === 'wrong-password' ? 403 : 400;
        return bad('Change password', path, passwordBody({ account, errors: result.errors ?? {} }), status);
      }
      return redirect('/account/security?done=password');
    }
  }

  /* ── Security ────────────────────────────────────────────────────────────────────────── */

  if (path === '/account/security' && method === 'GET') {
    const sessions = await accounts.listSessions(account.id, { currentToken: token });
    return html(shellFor('Security', path, account, securityBody({ account, sessions, url })));
  }

  if (path === '/account/security/sign-out-others' && method === 'POST') {
    await accounts.signOutOthers(account.id, { keepToken: token });
    return redirect('/account/security?done=signed-out-others');
  }

  if (path === '/account/security/revoke' && method === 'POST') {
    const fields = await formFields(request);
    await accounts.revokeSession(account.id, asString(fields?.sessionId), { keepToken: token });
    return redirect('/account/security?done=revoked');
  }

  /* ── Delete ──────────────────────────────────────────────────────────────────────────── */

  if (path === '/account/delete') {
    if (method === 'GET') return html(shellFor('Delete your account', path, account, deleteBody({ account })));
    if (method === 'POST') {
      const fields = await formFields(request);
      if (!fields) return bad('Delete your account', path, deleteBody({ account, errors: { confirmEmail: 'That was too large.' } }), 413);
      const wait = await limited();
      if (wait) return wait;

      if (fields.understand !== 'yes') {
        return bad('Delete your account', path, deleteBody({ account, errors: { understand: 'Tick the box to confirm you understand this is permanent.' } }));
      }

      const result = await accounts.deleteAccount(
        account.id,
        { currentPassword: asString(fields.currentPassword), confirmEmail: asString(fields.confirmEmail) },
        { beforeDelete: anonymiseTicketsFor(account.id) },
      );
      if (!result.ok) {
        const status = result.reason === 'wrong-password' ? 403 : 400;
        return bad('Delete your account', path, deleteBody({ account, errors: result.errors ?? {} }), status);
      }

      // The account and its rows are gone. The objects are not rows, so they are removed by
      // prefix afterwards; a failure here leaves an orphan object, never a live account.
      await purgeAvatars(env, account.id).catch((error) => console.error('[nova] avatar purge failed', error));
      return redirect('/account/deleted', { setCookies: [clearSessionCookie(), clearStatusCookie()] });
    }
  }

  return null;
}

export { ecosystemNote };
