/**
 * Connecting a Nova app to a Nova Account -- the human half of the device grant, on the Nova site.
 *
 * An installed Nova app (Atlas, Nova Cut, Replay.GG, Online Earth) shows an eight-character code
 * and sends the person to a page to approve it. That page used to be Nova.Help's; it is Nova's
 * now, because Nova is where somebody manages their account -- sign-in (including Google),
 * profile, security -- and sending them to a different site for the one step that matters most
 * made the ecosystem feel like two accounts. Nova.Help keeps serving the same routes, so a code
 * issued under either address can be approved at either.
 *
 * THIS FILE HOLDS NO SECURITY DECISIONS. Whether a code exists, has expired, was already used,
 * and what an approval grants are all decided by `@nova/accounts` (deviceService.mjs), the same
 * package Nova.Help runs against the same D1 database. The app's own endpoints
 * (/api/device/code, /api/device/token) stay on Nova.Help, which is where the Bearer-token API
 * lives; this site only ever DECIDES a grant that Nova.Help created, through the shared database.
 *
 * THE RULES, copied from server/deviceRoutes.mjs in Nova.Help because divergence between two
 * front doors onto one identity is how one of them ends up wrong:
 *
 *   A. APPROVAL IS A POST BY A SIGNED-IN PERSON. `GET /account/device?code=` only DESCRIBES a
 *      pending grant; `SameSite=Lax` plus POST-only is what stops another site approving a
 *      device on somebody's behalf.
 *   B. THE ACCOUNT COMES FROM THE SESSION. Never a form field, never the query string.
 *   C. APPROVING NEEDS THE CODE TYPED BACK. "Connect this app" only leads to a second step that
 *      asks for the code the APP is showing, so a link carrying the code cannot approve by
 *      itself -- the person has to be looking at the app that asked. Denying needs no proof.
 *   D. EVERY CODE TYPED IS RATE-LIMITED. Eight Crockford characters is plenty against a person
 *      and not much against a script, so this is the tightest limiter on the site.
 *   E. NO REFUSAL SAYS WHETHER A CODE EXISTS.
 */
import { normalizeUserCode } from '../../packages/nova-accounts/index.mjs';

import { esc, field, html, notice, page, redirect } from './shell.mjs';

const BODY_LIMIT = 8 * 1024;

/**
 * What each scope lets an app do, in the second person. Written out rather than shown as `sync`
 * because "this app may read and write the settings it saved to your account" is a sentence
 * somebody can decide about and `sync` is not. An unrecognised scope falls back to its own name
 * rather than being hidden: a permission this page cannot describe must still be visible.
 */
const SCOPE_WORDS = {
  identity: 'See that you are signed in, and your display name.',
  email: 'See the email address on your Nova Account.',
  support: 'File Nova.Help support tickets as you, and follow the ones it filed.',
  sync: 'Read and write the settings this app saves to your account — and nothing another app has saved.',
};

const scopeList = (scopes = []) =>
  `<ul class="ecosystem-list">${scopes
    .map((scope) => `<li><span class="ecosystem-name">${esc(SCOPE_WORDS[scope] ?? scope)}</span></li>`)
    .join('')}</ul>`;

const optional = `<div class="account-card">
  <h2 class="account-card-title">Connecting is optional</h2>
  <p class="account-card-lede">
    Every Nova app works without a Nova Account, and stays working if you never connect one.
    Connecting adds your identity across Nova products — it does not switch anything on that was
    off before.
  </p>
</div>`;

/** One sentence per refusal, and never one that says whether a code exists. */
const describeProblem = (reason) => {
  if (reason === 'expired') return 'That code has expired.';
  if (reason === 'already-decided') return 'That code has already been used.';
  return 'We could not find that code. Check the app and type it again.';
};

const codeFrom = (value) => String(value ?? '').trim();

/** Where a signed-out visitor is sent, and brought back to, carrying the code they arrived with. */
const signInFirst = (code) => {
  const next = code ? `/account/device?code=${encodeURIComponent(code)}` : '/account/device';
  return `/account/sign-in?next=${encodeURIComponent(next)}`;
};

const shell = (title, lede, account, body, status = 200) =>
  html(page({ title, lede, account, body }), { status });

/* ── Pages ───────────────────────────────────────────────────────────────────────────────── */

const doneBanner = (done) =>
  done
    ? notice(
        done === 'approved' ? 'ok' : 'warning',
        done === 'approved' ? 'That app is connected.' : 'Nothing was connected.',
        done === 'approved'
          ? '<p>You can go back to it now. Sign it out again whenever you like, from <a href="/account/security">your account’s security page</a>.</p>'
          : '<p>The app was not given access to your account.</p>',
      )
    : '';

const codeFormBody = ({ code = '', error = null, account = null, done = null }) => `
  ${doneBanner(done)}
  ${
    error
      ? notice(
          'error',
          'That code did not work.',
          `<p>${esc(error)}</p><p>Codes last ten minutes. If yours has run out, the app will show you a new one.</p>`,
        )
      : ''
  }
  <form class="account-card" method="post" action="/account/device/check" novalidate>
    <p class="account-card-lede">
      Your Nova app is showing an eight-character code. Type it here to connect it to your Nova
      Account.
    </p>
    ${field({
      id: 'code',
      label: 'Code from the app',
      value: code,
      hint: 'Upper or lower case, with or without the dash. For example KDMX-7QRT.',
      autocomplete: 'one-time-code',
      maxLength: 20,
    })}
    <div class="account-actions">
      <button class="btn btn-primary" type="submit">Continue <span class="arrow" aria-hidden="true">→</span></button>
    </div>
    ${account ? '' : '<p class="account-fineprint">You will be asked to sign in before anything is connected.</p>'}
  </form>
  ${optional}`;

const confirmBody = ({ grant, code, error = null }) => `
  ${error ? notice('error', 'That code did not match.', `<p>${esc(error)}</p>`) : ''}
  <form class="account-card" method="post" action="/account/device" novalidate>
    <h2 class="account-card-title">${esc(grant.productName)}</h2>
    <p class="account-card-lede">
      One last step. Type the eight-character code your app is showing to connect it. This makes
      sure you are approving the app in front of you.
    </p>
    <input type="hidden" name="code" value="${esc(code)}" />
    <input type="hidden" name="action" value="approve" />
    ${field({
      id: 'confirm',
      label: 'Code from the app',
      hint: 'Upper or lower case, with or without the dash.',
      autocomplete: 'off',
      maxLength: 20,
      error: error ? 'Check the app and try again.' : undefined,
    })}
    <div class="account-actions">
      <button class="btn btn-primary" type="submit">Connect <span class="arrow" aria-hidden="true">→</span></button>
      <a class="btn btn-ghost" href="/account/device">Cancel</a>
    </div>
  </form>`;

const approveBody = ({ grant, code, account }) => `
  <div class="account-card">
    <h2 class="account-card-title">${esc(grant.productName)}</h2>
    ${grant.productSummary ? `<p class="account-card-lede">${esc(grant.productSummary)}</p>` : ''}
    ${grant.deviceName ? `<p class="account-card-lede">It says it is running on <strong>${esc(grant.deviceName)}</strong>.</p>` : ''}
    <p class="account-card-lede"><strong>If you connect it, this app will be able to:</strong></p>
    ${scopeList(grant.scopes)}
    <p class="account-fineprint">
      It will be signed in as ${esc(account.displayName || account.email)} until you sign it out,
      which you can do at any time from <a href="/account/security">your account’s security page</a>.
      It never sees your password.
    </p>
    <div class="account-actions">
      <form method="post" action="/account/device" class="inline-form">
        <input type="hidden" name="code" value="${esc(code)}" />
        <input type="hidden" name="action" value="approve" />
        <button class="btn btn-primary" type="submit">Connect this app <span class="arrow" aria-hidden="true">→</span></button>
      </form>
      <form method="post" action="/account/device" class="inline-form">
        <input type="hidden" name="code" value="${esc(code)}" />
        <input type="hidden" name="action" value="deny" />
        <button class="btn btn-ghost" type="submit">Not now</button>
      </form>
    </div>
  </div>
  ${notice(
    'warning',
    'Did you not start this yourself?',
    '<p>Choose <strong>Not now</strong>. Nothing can be connected to your account without somebody approving it on this page, so refusing is the whole of what you need to do.</p>',
  )}`;

/* ── The routes ──────────────────────────────────────────────────────────────────────────── */

/**
 * Answers the device-approval routes, and returns null for every other path so the router goes
 * on to its own. Same contract as `handleManage`.
 */
export async function handleDevice(ctx) {
  const { request, env, url, path, method, accounts, account, limiterFor, tooMany, ip } = ctx;

  if (path !== '/account/device' && path !== '/account/device/check') return null;

  const verify = limiterFor(env, 'deviceVerify', 15 * 60 * 1000, 15);

  /* The code form, and -- when a code is present and real -- the confirmation. */
  if (path === '/account/device' && method === 'GET') {
    const code = codeFrom(url.searchParams.get('code'));
    const done = ['approved', 'denied'].includes(url.searchParams.get('done')) ? url.searchParams.get('done') : null;

    /* A FINISHED GRANT GETS A FINISHED PAGE, with no code field. Showing the form under "That
       app is connected" reads as the site asking for the code a second time. */
    if (done) {
      return shell(
        done === 'approved' ? 'You’re connected' : 'Nothing was connected',
        done === 'approved' ? 'You can close this tab and go back to the app.' : 'The app was not given access.',
        account,
        `${doneBanner(done)}
        <div class="account-actions"><a class="btn btn-ghost" href="/account">Go to your Nova Account</a></div>`,
      );
    }

    if (!account) {
      /* Signed out with a code in hand: sign in, then come back to it. With no code, still
         render the form -- the page explains itself before asking for anything, which is the
         difference between an invitation and a wall. */
      if (code) return redirect(signInFirst(code));
      return shell('Connect an app', 'Type the code your app is showing.', null, codeFormBody({ done }));
    }
    if (!code) return shell('Connect an app', 'Type the code your app is showing.', account, codeFormBody({ account, done }));

    const described = await accounts.describeDeviceAuthorization(code);
    if (!described.ok) {
      return shell('Connect an app', 'Type the code your app is showing.', account, codeFormBody({ account, code, error: describeProblem(described.reason) }), 404);
    }
    return shell('Connect this app?', 'Check that this is the app in front of you.', account, approveBody({ grant: described.grant, code, account }));
  }

  /* Look a code up. A POST because it is a form submission; it redirects to the GET that
     renders the confirmation, so that screen has a URL somebody can reload. */
  if (path === '/account/device/check' && method === 'POST') {
    const gate = await verify.hit(ip);
    if (!gate.ok) return tooMany(gate.retryAfter);

    const fields = await formFields(request);
    const code = codeFrom(fields?.code);
    if (!account) return redirect(signInFirst(code));
    return redirect(`/account/device?code=${encodeURIComponent(code)}`);
  }

  /* Approve or refuse -- the one state change. */
  if (path === '/account/device' && method === 'POST') {
    const gate = await verify.hit(ip);
    if (!gate.ok) return tooMany(gate.retryAfter);

    const fields = await formFields(request);
    const code = codeFrom(fields?.code);
    const approve = fields?.action === 'approve';
    if (!account) return redirect(signInFirst(code));

    if (approve) {
      const typed = codeFrom(fields?.confirm);
      const described = await accounts.describeDeviceAuthorization(code);
      if (!described.ok) {
        return shell('Connect an app', 'Type the code your app is showing.', account, codeFormBody({ account, code, error: describeProblem(described.reason) }), 404);
      }
      if (!typed || normalizeUserCode(typed) !== normalizeUserCode(code)) {
        return shell(
          'Enter the code',
          'Type the code shown in the app.',
          account,
          confirmBody({
            grant: described.grant,
            code,
            error: typed ? 'That does not match the code the app is showing. Check it and try again.' : null,
          }),
          typed ? 400 : 200,
        );
      }
    }

    const decided = await accounts.decideDeviceAuthorization(code, { accountId: account.id, approve });
    if (!decided.ok) {
      return shell('Connect an app', 'Type the code your app is showing.', account, codeFormBody({ account, code, error: describeProblem(decided.reason) }), 404);
    }
    return redirect(`/account/device?done=${approve ? 'approved' : 'denied'}`);
  }

  return null;
}

async function formFields(request) {
  const body = await request.text();
  if (body.length > BODY_LIMIT) return null;
  return Object.fromEntries(new URLSearchParams(body));
}
