/**
 * Google sign-in, wired into the Nova site's own Pages Function, against a real OpenID Connect
 * provider on a real port.
 *
 * WHAT IS REAL HERE. `test/helpers/harness.mjs` already drives `functions/account/[[path]].mjs`
 * directly against a real SQLite-backed D1 store — see its own doc comment. This file adds one
 * more real thing on top: `test/helpers/fakeProvider.mjs`, imported from the NovaHelp repo for
 * the same reason `sqliteD1.mjs` is (harness.mjs's own comment) — it is a local development
 * tool, not part of the shipped package, and one copy of it means a fix there is a fix here. It
 * is not a mock of the verification: it holds an RSA key, publishes a JWKS, signs real ID
 * tokens, and checks PKCE and the client secret at its token endpoint exactly as Google's does.
 * So the tests below exercise `packages/nova-accounts/providers/oidc.mjs`'s actual code —
 * signature check, issuer/audience check, PKCE round trip — for real, through Nova's own
 * routes, rather than through a stub told what to answer.
 *
 * THE TESTS THAT MATTER MOST ARE THE ONES THAT REFUSE — the "ATTACKER FIRST" / "ATTACKER
 * SECOND" pair near the bottom. A federated sign-in that signs people in is table stakes; one
 * that cannot be used to walk into somebody else's Nova Account by matching an address is the
 * feature. `@nova/accounts` enforces that at the service layer (see service.mjs's
 * `withProviderIdentity`, and account.test.mjs's own direct test of it) — what these two prove
 * is that Nova's own routes do not build around that rule on the way to it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { browser, createSite, PASSWORD } from './helpers/harness.mjs';
import { startFakeProvider } from '../../NovaHelp/test/helpers/fakeProvider.mjs';

/** A site whose Google provider is a throwaway OIDC server on localhost. */
async function siteWithGoogle(t, providerOptions = {}) {
  const google = await startFakeProvider(providerOptions);
  t.after(() => google.close());

  const site = await createSite(t);
  site.env.NOVA_GOOGLE_CLIENT_ID = google.clientId;
  site.env.NOVA_GOOGLE_SECRET = google.clientSecret;
  // The one hook `accountsFor` reads so a test can point the real provider code at this fake
  // server instead of accounts.google.com — see functions/_lib/accounts.mjs.
  site.env.NOVA_GOOGLE_ENDPOINTS = google.endpoints;

  return { site, google };
}

/** Press "Continue with Google" and read what Nova would have sent the browser to. */
async function beginGoogle(b, path = '/account/auth/google') {
  const response = await b.get(path);
  assert.equal(response.status, 303, `expected a redirect to the provider, got ${response.status}`);

  const target = new URL(response.headers.get('location'));
  return {
    response,
    target,
    state: target.searchParams.get('state'),
    nonce: target.searchParams.get('nonce'),
    challenge: target.searchParams.get('code_challenge'),
  };
}

const callback = (b, { code, state }) =>
  b.get(`/account/auth/google/callback?${new URLSearchParams({ ...(code ? { code } : {}), ...(state ? { state } : {}) })}`);

/** The whole round trip, for tests that only care where it ends up. */
async function signInWithGoogle(b, google, person, { start = '/account/auth/google' } = {}) {
  const flow = await beginGoogle(b, start);
  const code = google.grant({ ...person, nonce: flow.nonce, challenge: flow.challenge });
  return callback(b, { code, state: flow.state });
}

const signUpWithPassword = (b, email, extra = {}) => b.post('/account/new', { email, password: PASSWORD, passwordConfirm: PASSWORD, ...extra });

const accountRow = (db, email) => db.prepare('SELECT id, password, email_verified FROM accounts WHERE email_normalized = ?').bind(email).first();

const identityRows = (db, accountId) =>
  db.prepare('SELECT provider, subject, email FROM account_identities WHERE account_id = ?').bind(accountId).all().then((r) => r.results);

const accountCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM accounts').first('n');

/* ── The button, once configured ────────────────────────────────────────────────────────── */

test('once Google is configured, the button is a real link on both forms', async (t) => {
  const { site } = await siteWithGoogle(t);

  for (const path of ['/account/sign-in', '/account/new']) {
    const html = await browser(site).get(path).then((r) => r.text());
    assert.match(html, /Google/, `${path} mentions Google`);
    assert.equal(html.includes('Coming soon'), false, `${path} no longer says "coming soon"`);
    assert.equal(/disabled/.test(html.match(/<[^>]*provider-btn[^>]*>/)?.[0] ?? ''), false, `${path} button is not disabled`);
    assert.match(html, /href="\/account\/auth\/google"/, `${path} links straight to the flow`);
  }
});

test('a half-configured provider is ignored rather than half-offered, and logs a warning', async (t) => {
  const site = await createSite(t);
  site.env.NOVA_GOOGLE_CLIENT_ID = 'only-an-id';
  // NOVA_GOOGLE_SECRET left unset.

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const html = await browser(site).get('/account/sign-in').then((r) => r.text());
    assert.match(html, /Coming soon/, 'the control still falls back to the disabled state');
    assert.ok(warnings.some((w) => /half-configured/.test(w)), 'it says so loudly');
  } finally {
    console.warn = originalWarn;
  }

  // And the route does not quietly work either.
  assert.equal((await browser(site).get('/account/auth/google')).status, 404);
});

/* ── The flow is built correctly ────────────────────────────────────────────────────────── */

test('starting a flow sends the right request and seals the state in a cookie', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  const b = browser(site);

  const flow = await beginGoogle(b);

  assert.equal(flow.target.origin, google.origin);
  assert.equal(flow.target.pathname, '/authorize');
  assert.equal(flow.target.searchParams.get('client_id'), google.clientId);
  assert.equal(flow.target.searchParams.get('response_type'), 'code');
  assert.equal(flow.target.searchParams.get('code_challenge_method'), 'S256');
  assert.match(flow.target.searchParams.get('scope'), /openid/);
  assert.equal(flow.target.searchParams.get('redirect_uri'), 'https://nova.test/account/auth/google/callback');
  assert.ok(flow.state && flow.nonce && flow.challenge);
  assert.equal(flow.target.searchParams.has('code_verifier'), false, 'the PKCE verifier never reaches the browser');

  const cookie = flow.response.headers.getSetCookie().find((c) => c.startsWith('nova_oauth='));
  assert.ok(cookie, 'the state envelope must be set as a cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/, 'Strict would withhold the cookie on the callback navigation');
  assert.equal(cookie.includes(`nova_oauth=${flow.state}`), false, 'the cookie must not simply be the state');
});

test('the code exchange carries the client secret and the PKCE verifier', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  await signInWithGoogle(browser(site), google, { sub: 'g-1', email: 'ann@example.com' });

  assert.equal(google.tokenRequests.length, 1);
  const sent = google.tokenRequests[0];
  assert.equal(sent.grant_type, 'authorization_code');
  assert.equal(sent.client_id, google.clientId);
  assert.equal(sent.client_secret, google.clientSecret);
  assert.ok(sent.code_verifier, 'PKCE verifier must be sent');
  assert.equal(sent.redirect_uri, 'https://nova.test/account/auth/google/callback');
});

/* ── Successful authentication ──────────────────────────────────────────────────────────── */

test('a first Google sign-in creates a Nova Account and opens the same kind of session password sign-in does', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  const b = browser(site);

  const done = await signInWithGoogle(b, google, { sub: 'google-sub-1', email: 'Ann@Example.com', name: 'Ann Example' });

  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account?welcome=created');
  assert.ok(
    (done.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')),
    'the same session cookie a password sign-in sets',
  );
  assert.equal((done.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_oauth=') && !/Max-Age=0/.test(c)), false, 'the envelope must be spent');

  const row = await accountRow(site.db, 'ann@example.com');
  assert.ok(row, 'an account should exist');
  assert.equal(row.password, null, 'no password is invented for a federated account');
  assert.equal(row.email_verified, 1, 'Google confirmed the address');
  assert.deepEqual(await identityRows(site.db, row.id), [{ provider: 'google', subject: 'google-sub-1', email: 'ann@example.com' }]);

  const page = await b.get('/account').then((r) => r.text());
  assert.match(page, /ann@example\.com/);
  assert.match(page, /Ann Example/);
});

test('a second Google sign-in signs in to the same account rather than making another', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  await signInWithGoogle(browser(site), google, { sub: 'google-sub-1', email: 'ann@example.com' });
  const first = await accountRow(site.db, 'ann@example.com');

  const second = browser(site);
  const done = await signInWithGoogle(second, google, { sub: 'google-sub-1', email: 'ann@example.com' });

  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account?welcome=signed-in');
  assert.equal(await accountCount(site.db), 1, 'no second account may be created');

  const page = await second.get('/account').then((r) => r.text());
  assert.match(page, /ann@example\.com/);
});

test('the identity is matched on the provider subject, not on the address', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  await signInWithGoogle(browser(site), google, { sub: 'google-sub-1', email: 'ann@example.com' });
  const before = await accountRow(site.db, 'ann@example.com');

  // The same person, who has since changed the address on their Google account.
  const later = browser(site);
  const done = await signInWithGoogle(later, google, { sub: 'google-sub-1', email: 'ann@newplace.example' });

  assert.equal(done.headers.get('location'), '/account?welcome=signed-in');
  assert.equal(await accountCount(site.db), 1);

  const after = await accountRow(site.db, 'ann@example.com');
  assert.equal(after.id, before.id, "a provider must not move a Nova Account's address");
  const identities = await identityRows(site.db, after.id);
  assert.equal(identities[0].email, 'ann@newplace.example', 'but the identity record follows it');
});

test('a Google-created account cannot be opened with a password', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  await signInWithGoogle(browser(site), google, { sub: 'google-sub-1', email: 'ann@example.com' });

  const attacker = browser(site);
  const attempt = await attacker.post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD });
  assert.equal(attempt.status, 401, 'a guessed password must not open a passwordless account');
  assert.equal((attempt.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')), false);
});

/* ── Linking ─────────────────────────────────────────────────────────────────────────────── */

test('a signed-in account can connect Google, and it is the same account', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  const b = browser(site);

  await signUpWithPassword(b, 'ann@example.com');
  const before = await accountRow(site.db, 'ann@example.com');

  // Signed in already, so `/account/auth/google` LINKS rather than signs in — decided from the
  // session cookie this request carries, never from a parameter. See [[path]].mjs.
  const done = await signInWithGoogle(b, google, { sub: 'google-sub-1', email: 'ann@example.com' });

  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account?welcome=linked');
  assert.equal(await accountCount(site.db), 1, 'linking must not create a second account');

  const identities = await identityRows(site.db, before.id);
  assert.deepEqual(identities.map((i) => i.subject), ['google-sub-1']);
  const after = await accountRow(site.db, 'ann@example.com');
  assert.equal(after.password, before.password, 'the password is untouched');

  // And now Google alone opens that same account, on a clean device.
  const elsewhere = browser(site);
  const signedIn = await signInWithGoogle(elsewhere, google, { sub: 'google-sub-1', email: 'ann@example.com' });
  assert.equal(signedIn.headers.get('location'), '/account?welcome=signed-in');
  assert.match(await elsewhere.get('/account').then((r) => r.text()), /ann@example\.com/);
  assert.equal(await accountCount(site.db), 1, 'still one account, not a second created by the second device');
});

test('a provider identity already on one account cannot be attached to another', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  const ann = browser(site);
  await signInWithGoogle(ann, google, { sub: 'shared-sub', email: 'ann@example.com' });
  const annRow = await accountRow(site.db, 'ann@example.com');

  const bob = browser(site);
  await signUpWithPassword(bob, 'bob@example.com');
  const done = await signInWithGoogle(bob, google, { sub: 'shared-sub', email: 'ann@example.com' });

  assert.equal(done.headers.get('location'), '/account?oauth=identity-taken');

  const stillAnns = await site.db.prepare('SELECT account_id FROM account_identities WHERE provider = ? AND subject = ?').bind('google', 'shared-sub').first();
  assert.equal(stillAnns.account_id, annRow.id, 'the identity must stay where it was');
  assert.deepEqual(await identityRows(site.db, (await accountRow(site.db, 'bob@example.com')).id), []);
});

/* ── Preventing takeover through unsafe automatic linking ───────────────────────────────────
   The policy itself ("an address match is never enough") is enforced by @nova/accounts and is
   already proven directly against the service in account.test.mjs. These two prove Nova's own
   routes reach that enforcement rather than deciding something else on the way there. */

test('ATTACKER FIRST: a password account on an address does not absorb that address’s Google identity', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  // An attacker registers the victim's address with a password. Nova sends no mail, so nothing
  // stopped them claiming it — which is exactly the situation the linking rule exists for.
  const attacker = browser(site);
  await signUpWithPassword(attacker, 'victim@example.com', { displayName: 'Not The Victim' });
  const attackerAccount = await accountRow(site.db, 'victim@example.com');

  // The real owner of the address arrives with Google.
  const victim = browser(site);
  const done = await signInWithGoogle(victim, google, { sub: 'the-real-victim', email: 'victim@example.com' });

  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account/sign-in?oauth=email-has-account');

  assert.equal((done.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')), false, 'the victim must NOT be signed into the attacker account');
  assert.equal(await accountCount(site.db), 1, 'no account may be created behind the refusal');
  assert.deepEqual(await identityRows(site.db, attackerAccount.id), [], "the attacker's account must not gain the victim's identity");

  const page = await victim.get('/account/sign-in?oauth=email-has-account').then((r) => r.text());
  assert.match(page, /already has a Nova Account/i);
});

test('ATTACKER SECOND: a Google identity asserting an existing account address is refused', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  const victim = browser(site);
  await signUpWithPassword(victim, 'victim@example.com');
  const victimAccount = await accountRow(site.db, 'victim@example.com');

  // An attacker turns up with a provider identity claiming the victim's address.
  const attacker = browser(site);
  const done = await signInWithGoogle(attacker, google, { sub: 'attacker-google-sub', email: 'victim@example.com' });

  assert.equal(done.headers.get('location'), '/account/sign-in?oauth=email-has-account');
  assert.equal((done.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')), false);
  assert.equal(await accountCount(site.db), 1);
  assert.deepEqual(await identityRows(site.db, victimAccount.id), []);

  // And the account itself is untouched — signing in as the attacker never reaches it.
  assert.equal((await attacker.get('/account')).status, 303, 'the attacker is not signed in at all');
});

/* ── Invalid state ───────────────────────────────────────────────────────────────────────── */

test('a callback with no state cookie signs nobody in (login CSRF)', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  // A flow really was started — in somebody else's browser.
  const attacker = browser(site);
  const flow = await beginGoogle(attacker);
  const code = google.grant({ sub: 'attacker-sub', email: 'attacker@example.com', nonce: flow.nonce, challenge: flow.challenge });

  // The victim's browser is sent to the callback carrying the attacker's code and state. This
  // is login CSRF, and the missing cookie in the victim's own jar is what stops it.
  const victim = browser(site);
  const done = await callback(victim, { code, state: flow.state });

  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account/sign-in?oauth=failed');
  assert.equal((done.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')), false);
});

test('a tampered state cookie signs nobody in', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  const b = browser(site);

  const flow = await beginGoogle(b);
  const code = google.grant({ sub: 'g-1', email: 'ann@example.com', nonce: flow.nonce, challenge: flow.challenge });

  // The jar stores the raw, still-percent-encoded value straight off Set-Cookie; decode once
  // to tamper with the actual envelope, matching what `readCookie` in [[path]].mjs would see.
  const envelope = decodeURIComponent(b.jar.get('nova_oauth'));
  const cut = envelope.lastIndexOf('.');
  const [body, signature] = [envelope.slice(0, cut), envelope.slice(cut + 1)];

  for (const forged of [`${body}.${signature.slice(0, -2)}xx`, `${body}x.${signature}`, body, 'nonsense']) {
    b.jar.set('nova_oauth', encodeURIComponent(forged));
    const response = await b.get(`/account/auth/google/callback?code=${code}&state=${flow.state}`);
    assert.equal(response.headers.get('location'), '/account/sign-in?oauth=failed', 'a forged envelope must be refused');
    assert.equal((response.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')), false);
  }
});

test('the state envelope is single use', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  const b = browser(site);

  const flow = await beginGoogle(b);
  const first = google.grant({ sub: 'g-1', email: 'ann@example.com', nonce: flow.nonce, challenge: flow.challenge });
  const replay = google.grant({ sub: 'g-1', email: 'ann@example.com', nonce: flow.nonce, challenge: flow.challenge });

  const ok = await callback(b, { code: first, state: flow.state });
  assert.equal(ok.headers.get('location'), '/account?welcome=created');

  // The same state, replayed with a fresh code from the same flow. There is no envelope left
  // to open — cleared the moment it was read — so this is refused like any other callback that
  // cannot prove this browser started it, and lands on the account page since they are signed in.
  const again = await callback(b, { code: replay, state: flow.state });
  assert.match(again.headers.get('location'), /^\/account\?oauth=failed/);
});

test('an identity token that fails verification signs nobody in', async (t) => {
  const forgeries = {
    'wrong issuer': { claims: { iss: 'https://accounts.evil.example' } },
    'wrong audience': { claims: { aud: 'some-other-client.apps.googleusercontent.com' } },
    'mismatched nonce': { nonceOverride: 'a-nonce-from-another-flow' },
    'algorithm "none"': { header: { alg: 'none' } },
  };

  for (const [label, forgery] of Object.entries(forgeries)) {
    const { site, google } = await siteWithGoogle(t);
    const b = browser(site);

    const flow = await beginGoogle(b);
    const code = google.grant({
      sub: 'g-1',
      email: 'ann@example.com',
      nonce: forgery.nonceOverride ?? flow.nonce,
      challenge: flow.challenge,
      claims: forgery.claims,
      header: forgery.header,
    });

    const done = await callback(b, { code, state: flow.state });
    assert.match(done.headers.get('location'), /oauth=failed/, `${label} should be refused`);
    assert.equal(await accountCount(site.db), 0, `${label} must not create an account`);
  }
});

test('a provider that will not vouch for the address is refused outright', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  const b = browser(site);
  const done = await signInWithGoogle(b, google, { sub: 'unverified-1', email: 'someone@example.com', claims: { email_verified: false } });

  assert.equal(done.headers.get('location'), '/account/sign-in?oauth=unverified');
  assert.equal(await accountCount(site.db), 0, 'no account may be created without a confirmed address');
});

/* ── next= is still sanitised ───────────────────────────────────────────────────────────────
   `beginFlow` reuses the router's own `safeNext`; this is a regression check that federated
   sign-in did not get its own, laxer copy of that rule. */

test('next= cannot be used to bounce somebody off the site through the Google flow', async (t) => {
  const { site, google } = await siteWithGoogle(t);

  for (const hostile of ['https://evil.example/steal', '//evil.example']) {
    const b = browser(site);
    const done = await signInWithGoogle(
      b,
      google,
      { sub: `g-${Math.random()}`, email: `user-${Math.random().toString(36).slice(2, 8)}@example.com` },
      { start: `/account/auth/google?next=${encodeURIComponent(hostile)}` },
    );
    assert.ok(done.headers.get('location').startsWith('/account'), `next=${hostile} escaped to ${done.headers.get('location')}`);
  }
});

test('a Google sign-in returns the person to where they were going', async (t) => {
  const { site, google } = await siteWithGoogle(t);
  const b = browser(site);

  const done = await signInWithGoogle(b, google, { sub: 'g-1', email: 'ann@example.com' }, { start: '/account/auth/google?next=%2Fecosystem.html' });
  assert.equal(done.headers.get('location'), '/ecosystem.html');
});

/* ── Everything that was working still works ────────────────────────────────────────────── */

test('password sign-up and sign-in are untouched by any of this', async (t) => {
  const { site } = await siteWithGoogle(t);

  const b = browser(site);
  assert.equal((await signUpWithPassword(b, 'ann@example.com')).status, 303);
  assert.equal((await b.get('/account')).status, 200);

  const again = browser(site);
  const signedIn = await again.post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD });
  assert.equal(signedIn.status, 303);
});
