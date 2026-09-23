/**
 * The Nova site's account flows, and the thing they exist to prove:
 *
 *     A NOVA ACCOUNT AND A NOVA.HELP ACCOUNT ARE THE SAME ACCOUNT.
 *
 * The cross-product tests near the bottom are the ones that matter most. They stand both front
 * doors up over ONE database, create an account through one, and sign in through the other —
 * then check the account row itself to show there is exactly one, used by two products, rather
 * than two rows that happen to share an address.
 *
 * Everything else here checks that this front door behaves like the tested one: the same
 * generic sign-in failure, the same refusal to say who has an account, the same single-use
 * reset link, the same session revocation. It should: it is the same package underneath. These
 * tests are what stops that quietly stopping being true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccounts } from '@nova/accounts';
import { createD1AccountStore } from '@nova/accounts/d1Store';
import { createMemoryMailer } from '@nova/accounts';

import { browser, createSite, linkFrom, tokenFrom, NEW_PASSWORD, PASSWORD } from './helpers/harness.mjs';

const signUp = (b, email, extra = {}) =>
  b.post('/account/new', { email, password: PASSWORD, passwordConfirm: PASSWORD, ...extra });

/* ── Creating an account from Nova ───────────────────────────────────────────────────────── */

test('the sign-up form creates an account and signs the person in', async (t) => {
  const site = await createSite(t);
  const b = browser(site);

  const form = await b.get('/account/new');
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Create a Nova Account/);

  const created = await signUp(b, 'ann@example.com', { displayName: 'Ann' });
  assert.equal(created.status, 303, await created.text());
  assert.equal(created.headers.get('location'), '/account?welcome=created');
  assert.match(created.headers.get('set-cookie') ?? '', /^nova_session=/);

  const page = await b.get('/account');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /ann@example\.com/);
  assert.match(html, /Your Nova Account/);
});

test('the account row is a real Nova Account, with the password hashed', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'ann@example.com');

  const row = await site.db
    .prepare('SELECT id, email, password, status FROM accounts WHERE email_normalized = ?')
    .bind('ann@example.com')
    .first();

  assert.ok(row.id.startsWith('NA-'), 'a Nova Account id');
  assert.match(row.password, /^scrypt\$/, 'a hash record, never the password');
  assert.equal(row.status, 'active');
});

test('signing up records that the account has been used with Nova', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'ann@example.com');

  const products = await site.db
    .prepare('SELECT product FROM account_products p JOIN accounts a ON a.id = p.account_id WHERE a.email_normalized = ?')
    .bind('ann@example.com')
    .all();

  assert.deepEqual(products.results.map((r) => r.product), ['nova']);
});

test('a taken address is refused, and a bad password is explained', async (t) => {
  const site = await createSite(t);
  assert.equal((await signUp(browser(site), 'ann@example.com')).status, 303);

  const clash = await signUp(browser(site), 'ann@example.com');
  assert.equal(clash.status, 422);
  assert.match(await clash.text(), /already uses that address/i);

  const weak = await browser(site).post('/account/new', {
    email: 'new@example.com',
    password: 'short',
    passwordConfirm: 'short',
  });
  assert.equal(weak.status, 422);
  assert.match(await weak.text(), /at least 10 characters/i);
});

/* ── Signing in ──────────────────────────────────────────────────────────────────────────── */

test('sign in works, and the wrong password does not', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'ann@example.com');

  const wrong = await browser(site).post('/account/sign-in', { email: 'ann@example.com', password: 'not it' });
  assert.equal(wrong.status, 401);

  const right = browser(site);
  const ok = await right.post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/account?welcome=signed-in');
  assert.equal((await right.get('/account')).status, 200);
});

test('an unknown address fails exactly like a wrong password', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'real@example.com');

  const unknown = await browser(site).post('/account/sign-in', { email: 'nobody@example.com', password: PASSWORD });
  const wrong = await browser(site).post('/account/sign-in', { email: 'real@example.com', password: 'not it' });

  assert.equal(unknown.status, wrong.status, 'same status');
  const strip = (html) => html.replaceAll('nobody@example.com', 'X').replaceAll('real@example.com', 'X');
  assert.equal(strip(await unknown.text()), strip(await wrong.text()), 'same page');
});

test('a disabled account cannot sign in, and is not told it is disabled', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'off@example.com');
  await site.db.prepare("UPDATE accounts SET status = 'disabled' WHERE email_normalized = ?").bind('off@example.com').run();

  const disabled = await browser(site).post('/account/sign-in', { email: 'off@example.com', password: PASSWORD });
  const wrong = await browser(site).post('/account/sign-in', { email: 'off@example.com', password: 'not it' });

  assert.equal(disabled.status, 401);
  assert.equal(disabled.status, wrong.status);
});

test('an incomplete form is a per-field error, not the generic failure', async (t) => {
  const site = await createSite(t);
  const response = await browser(site).post('/account/sign-in', { email: '', password: '' });
  assert.equal(response.status, 422);
  assert.match(await response.text(), /Enter your email address/i);
});

/* ── Sessions ────────────────────────────────────────────────────────────────────────────── */

test('the account page requires a session', async (t) => {
  const site = await createSite(t);
  const response = await browser(site).get('/account');
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /\/account\/sign-in/);
});

test('signing out revokes the session, so the old cookie stops working', async (t) => {
  const site = await createSite(t);
  const b = browser(site);
  await signUp(b, 'ann@example.com');
  const stolen = b.cookieHeader();

  const out = await b.post('/account/sign-out', {});
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), '/');

  assert.equal(
    await site.db.prepare('SELECT COUNT(*) AS n FROM account_sessions').first('n'),
    0,
    'the session is gone from the store, not just the browser',
  );

  /* The whole reason sessions are stored rather than only signed: the old cookie is still a
     valid signature and must still stop working. */
  const replay = await browser(site).get('/account', { headers: { cookie: stolen } });
  assert.equal(replay.status, 303);
});

test('a forged or altered cookie is not a session', async (t) => {
  const site = await createSite(t);
  const b = browser(site);
  await signUp(b, 'ann@example.com');
  /* Sign-up now sets a SECOND cookie too (`nova_status`, the cross-site status ping — see
     [[path]].mjs's `statusCookie`), so the jar's OWN copy of the real session value is what
     gets tampered, rather than slicing whatever the combined cookie header happens to end
     with — which, since it now names two cookies, might not even land inside `nova_session`. */
  const real = b.jar.get('nova_session');
  const tampered = `nova_session=${real.slice(0, -4)}AAAA`;

  assert.equal((await browser(site).get('/account', { headers: { cookie: tampered } })).status, 303);
  assert.equal((await browser(site).get('/account', { headers: { cookie: 'nova_session=nonsense' } })).status, 303);
});

test('the status endpoint answers only about the person asking', async (t) => {
  const site = await createSite(t);
  const b = browser(site);

  const anonymous = await browser(site).get('/account/status');
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { signedIn: false });

  await signUp(b, 'ann@example.com', { displayName: 'Ann' });
  const signedIn = await b.get('/account/status');
  const body = await signedIn.json();
  assert.equal(body.signedIn, true);
  assert.equal(body.name, 'Ann');
  assert.match(signedIn.headers.get('cache-control'), /no-store/);
});

/* ── Cross-site status: NovaLegal's header chip ──────────────────────────────────────────────
 *
 * See [[path]].mjs's `statusCookie` comment for the reasoning. Three things earn their own
 * test: the response never carries a name cross-site even when allow-listed, an origin NOT on
 * the allowlist gets no CORS headers (so its own JavaScript cannot read the body — the browser
 * enforces that, not this code, but the code has to actually leave the headers off), and
 * signing out kills the cross-site answer too. */

test('a cross-site request from an allow-listed origin gets signedIn only, with CORS headers', async (t) => {
  const site = await createSite(t);
  const b = browser(site);
  await signUp(b, 'ann@example.com', { displayName: 'Ann' });

  const res = await b.get('/account/status', { headers: { origin: 'http://localhost:4500' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signedIn: true }); // no `name` — see the file comment
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:4500');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(res.headers.get('vary'), 'Origin');
});

test('a cross-site request from an origin NOT on the allowlist gets no CORS headers', async (t) => {
  const site = await createSite(t);
  const b = browser(site);
  await signUp(b, 'ann@example.com', { displayName: 'Ann' });

  const res = await b.get('/account/status', { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 200); // the body exists; CORS, not a 403, is what stops it being read
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
});

test('a signed-out cross-site caller gets signedIn: false', async (t) => {
  const site = await createSite(t);
  const anon = await browser(site).get('/account/status', { headers: { origin: 'http://localhost:4500' } });
  assert.deepEqual(await anon.json(), { signedIn: false });
});

test('signing out ends the cross-site answer too, not only the same-site one', async (t) => {
  const site = await createSite(t);
  const b = browser(site);
  await signUp(b, 'ann@example.com');
  assert.equal(b.jar.has('nova_status'), true);
  const stolenStatusCookie = b.jar.get('nova_status');

  const before = await b.get('/account/status', { headers: { origin: 'http://localhost:4500' } });
  assert.equal((await before.json()).signedIn, true);

  await b.post('/account/sign-out', {});
  assert.equal(b.jar.has('nova_status'), false); // the cookie itself was cleared

  // Even a copy of the OLD token, taken before sign-out, no longer resolves to a live session.
  const replay = await browser(site).get('/account/status', {
    headers: { origin: 'http://localhost:4500', cookie: `nova_status=${stolenStatusCookie}` },
  });
  assert.deepEqual(await replay.json(), { signedIn: false });
});

/* ── Password reset ──────────────────────────────────────────────────────────────────────── */

test('a reset link arrives, works once, and signs the person in', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'ann@example.com');

  const asked = await browser(site).post('/account/forgot', { email: 'ann@example.com' });
  assert.equal(asked.status, 200);
  assert.match(await asked.text(), /Check your email/i);
  assert.equal(site.mailer.sent.length, 1);

  const opening = browser(site);
  const form = await opening.get(linkFrom(site.mailer));
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Choose a new password/i);

  const token = tokenFrom(site.mailer);
  const saved = await opening.post('/account/reset', {
    token,
    password: NEW_PASSWORD,
    passwordConfirm: NEW_PASSWORD,
  });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('location'), '/account?welcome=password-reset');

  // Spent.
  const again = await browser(site).post('/account/reset', {
    token,
    password: NEW_PASSWORD,
    passwordConfirm: NEW_PASSWORD,
  });
  assert.equal(again.status, 400);

  // Old password dead, new one works.
  assert.equal((await browser(site).post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD })).status, 401);
  assert.equal((await browser(site).post('/account/sign-in', { email: 'ann@example.com', password: NEW_PASSWORD })).status, 303);
});

test('resetting signs every other device out', async (t) => {
  const site = await createSite(t);
  const laptop = browser(site);
  await signUp(laptop, 'ann@example.com');
  const phone = browser(site);
  await phone.post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD });
  assert.equal((await phone.get('/account')).status, 200);

  await browser(site).post('/account/forgot', { email: 'ann@example.com' });
  await browser(site).post('/account/reset', {
    token: tokenFrom(site.mailer),
    password: NEW_PASSWORD,
    passwordConfirm: NEW_PASSWORD,
  });

  assert.equal((await phone.get('/account')).status, 303, 'the phone was signed out');
  assert.equal((await laptop.get('/account')).status, 303);
});

test('a notification follows a successful reset, and not a failed one', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'ann@example.com');
  await browser(site).post('/account/forgot', { email: 'ann@example.com' });
  assert.equal(site.mailer.sent.length, 1);

  await browser(site).post('/account/reset', { token: 'NA-BAD.nope', password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD });
  assert.equal(site.mailer.sent.length, 1, 'a failed attempt notifies nobody');

  await browser(site).post('/account/reset', {
    token: tokenFrom(site.mailer),
    password: NEW_PASSWORD,
    passwordConfirm: NEW_PASSWORD,
  });
  assert.equal(site.mailer.sent.length, 2);
  assert.match(site.mailer.sent[1].subject, /password was changed/i);
});

test('the forgot form says the same thing whether or not the address has an account', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'real@example.com');

  const known = await browser(site).post('/account/forgot', { email: 'real@example.com' });
  const unknown = await browser(site).post('/account/forgot', { email: 'nobody@example.com' });

  assert.equal(known.status, unknown.status);
  const strip = (html) => html.replaceAll('real@example.com', 'X').replaceAll('nobody@example.com', 'X');
  assert.equal(strip(await known.text()), strip(await unknown.text()), 'byte-identical once the typed address is masked');

  assert.equal(site.mailer.sent.length, 1, 'the only difference is the mailbox');
  assert.equal(site.mailer.sent[0].to, 'real@example.com');
});

test('a dead link gets an explanation, never a form', async (t) => {
  const site = await createSite(t);
  for (const token of ['', 'nonsense', 'NA-X.', '.secret']) {
    const response = await browser(site).get(`/account/reset?token=${encodeURIComponent(token)}`);
    assert.equal(response.status, 400, `token ${JSON.stringify(token)}`);
    const html = await response.text();
    assert.equal(/name="password"/.test(html), false);
    assert.match(html, /Ask for another link/i);
  }
});

test('a weak new password is refused without spending the link', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'ann@example.com');
  await browser(site).post('/account/forgot', { email: 'ann@example.com' });
  const token = tokenFrom(site.mailer);

  const weak = await browser(site).post('/account/reset', { token, password: 'abc', passwordConfirm: 'abc' });
  assert.equal(weak.status, 422);

  const good = await browser(site).post('/account/reset', {
    token,
    password: NEW_PASSWORD,
    passwordConfirm: NEW_PASSWORD,
  });
  assert.equal(good.status, 303, 'the link survived the refusal');
});

/* ── Google is not available ─────────────────────────────────────────────────────────────── */

test('Google is offered as coming soon, and is not wired to anything', async (t) => {
  const site = await createSite(t);

  for (const path of ['/account/sign-in', '/account/new']) {
    const html = await browser(site).get(path).then((r) => r.text());
    assert.match(html, /Continue with Google/, `${path} shows the control`);
    assert.match(html, /Coming soon/, `${path} says it is not ready`);
    assert.match(html, /disabled/, `${path} disables it`);

    /* It must not be a link or a form target — a "coming soon" that is secretly wired up is
       how a half-finished OAuth integration reaches production. */
    assert.equal(/href="[^"]*google/i.test(html), false, `${path} has no Google link`);
    assert.equal(/action="[^"]*google/i.test(html), false, `${path} posts nowhere`);
  }
});

test('with no provider configured, starting a flow finds nothing to start', async (t) => {
  const site = await createSite(t);

  // Beginning a flow for a provider nobody configured is a plain 404 — the same answer
  // Nova.Help gives (see registerAccountRoutes's notFoundAuth), not a redirect anywhere.
  const started = await browser(site).get('/account/auth/google');
  assert.equal(started.status, 404, '/account/auth/google must not exist');
  assert.equal((started.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_oauth=')), false);

  // A path nobody registered at all.
  assert.equal((await browser(site).get('/account/google')).status, 404);

  /* The callback route itself is generic — `/account/auth/:id/callback` — and always exists so
     ANY provider's callback lands somewhere; it is what decides, per request, whether `:id` is
     one Nova configured. With no envelope cookie and no provider, it fails exactly like any
     other invalid callback: a redirect carrying `oauth=failed`, never a session. */
  const hit = await browser(site).get('/account/auth/google/callback?code=x&state=y');
  assert.equal(hit.status, 303);
  assert.match(hit.headers.get('location'), /^\/account\/sign-in\?oauth=failed$/);
  assert.equal((hit.headers.getSetCookie() ?? []).some((c) => c.startsWith('nova_session=')), false);
});

/* ── ONE identity, two front doors ───────────────────────────────────────────────────────── */

/** Nova.Help's service, over the SAME database the Nova site is using. */
const novaHelpOver = (db, mailer) =>
  createAccounts({
    secret: 'a-test-signing-secret-of-sufficient-length',
    store: createD1AccountStore({ db }),
    product: 'nova.help',
    productName: 'Nova',
    cost: { N: 1024, r: 8, p: 1 },
    mailer,
  });

test('an account created on Nova can sign in through Nova.Help', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'shared@example.com');

  const novaHelp = await novaHelpOver(site.db, site.mailer);
  const attempt = await novaHelp.signIn({ email: 'shared@example.com', password: PASSWORD });

  assert.equal(attempt.ok, true, 'the same password works on the other front door');
  assert.equal(attempt.account.email, 'shared@example.com');
});

test('an account created on Nova.Help can sign in through Nova', async (t) => {
  const site = await createSite(t);
  const novaHelp = await novaHelpOver(site.db, site.mailer);

  const registered = await novaHelp.register({
    email: 'fromhelp@example.com',
    password: PASSWORD,
    passwordConfirm: PASSWORD,
  });
  assert.equal(registered.ok, true);

  const b = browser(site);
  const signedIn = await b.post('/account/sign-in', { email: 'fromhelp@example.com', password: PASSWORD });
  assert.equal(signedIn.status, 303, 'no separate Nova account was needed');
  assert.match(await b.get('/account').then((r) => r.text()), /fromhelp@example\.com/);
});

test('there is exactly ONE account row, whichever door was used', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'one@example.com');

  const novaHelp = await novaHelpOver(site.db, site.mailer);

  // Nova.Help cannot create a second account for the address...
  const second = await novaHelp.register({
    email: 'one@example.com',
    password: 'a completely different passphrase',
    passwordConfirm: 'a completely different passphrase',
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'email-taken');

  // ...because there is one, and it is the one Nova made.
  const rows = await site.db.prepare('SELECT id FROM accounts WHERE email_normalized = ?').bind('one@example.com').all();
  assert.equal(rows.results.length, 1, 'ONE account, not one per product');
  assert.equal((await site.db.prepare('SELECT COUNT(*) AS n FROM accounts').first('n')), 1);
});

test('using both products records both, on the one account', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'both@example.com');

  const novaHelp = await novaHelpOver(site.db, site.mailer);
  const attempt = await novaHelp.signIn({ email: 'both@example.com', password: PASSWORD });
  await novaHelp.startSession(attempt.account.id);

  const products = await site.db
    .prepare('SELECT product FROM account_products p JOIN accounts a ON a.id = p.account_id WHERE a.email_normalized = ? ORDER BY product')
    .bind('both@example.com')
    .all();

  assert.deepEqual(
    products.results.map((r) => r.product),
    ['nova', 'nova.help'],
    'one account, used with two products — the ecosystem seam',
  );
  assert.equal(await site.db.prepare('SELECT COUNT(*) AS n FROM accounts').first('n'), 1);
});

test('a password reset started on Nova changes the password for Nova.Help too', async (t) => {
  const site = await createSite(t);
  await signUp(browser(site), 'reset@example.com');

  await browser(site).post('/account/forgot', { email: 'reset@example.com' });
  await browser(site).post('/account/reset', {
    token: tokenFrom(site.mailer),
    password: NEW_PASSWORD,
    passwordConfirm: NEW_PASSWORD,
  });

  const novaHelp = await novaHelpOver(site.db, site.mailer);
  assert.equal((await novaHelp.signIn({ email: 'reset@example.com', password: PASSWORD })).ok, false, 'old password dead everywhere');
  assert.equal((await novaHelp.signIn({ email: 'reset@example.com', password: NEW_PASSWORD })).ok, true, 'new password works everywhere');
});

test('a session opened on Nova.Help is recognised by Nova', async (t) => {
  /* The session token is signed with a key derived from the shared secret and validated against
     the shared session list, so a token minted by one front door verifies at the other. Today
     the COOKIE cannot cross domains — that is why NOVA_COOKIE_DOMAIN exists and why the sites
     must share a registrable domain for single-sign-on. The token itself is already portable,
     which is what this proves. */
  const site = await createSite(t);
  const novaHelp = await novaHelpOver(site.db, site.mailer);

  const registered = await novaHelp.register({
    email: 'sso@example.com',
    password: PASSWORD,
    passwordConfirm: PASSWORD,
  });
  const started = await novaHelp.startSession(registered.account.id);
  assert.equal(started.ok, true);

  const response = await browser(site).get('/account', {
    headers: { cookie: `nova_session=${encodeURIComponent(started.token)}` },
  });
  assert.equal(response.status, 200, 'Nova accepted a session Nova.Help opened');
  assert.match(await response.text(), /sso@example\.com/);
});

test('signing out on Nova ends the session Nova.Help opened', async (t) => {
  const site = await createSite(t);
  const novaHelp = await novaHelpOver(site.db, site.mailer);
  const registered = await novaHelp.register({ email: 'out@example.com', password: PASSWORD, passwordConfirm: PASSWORD });
  const started = await novaHelp.startSession(registered.account.id);

  const cookie = `nova_session=${encodeURIComponent(started.token)}`;
  const out = await browser(site).post('/account/sign-out', {}, { headers: { cookie } });
  assert.equal(out.status, 303);

  assert.equal(await novaHelp.resolveSession(started.token), null, 'revoked for both');
});

/* ── Provider linking rules are untouched ────────────────────────────────────────────────── */

test('a matching email address still does not link a provider identity', async (t) => {
  /* The rule that stops account takeover, restated here because Nova is now a second front
     door onto the same accounts and it must not become the place where the rule is relaxed. */
  const site = await createSite(t);
  await signUp(browser(site), 'target@example.com');

  const novaHelp = await novaHelpOver(site.db, site.mailer);
  const attempt = await novaHelp.withProviderIdentity({
    provider: 'google',
    subject: 'google-sub-1',
    email: 'target@example.com',
    emailVerified: true,
    displayName: 'Not Ann',
  });

  assert.equal(attempt.ok, false, 'refused, not linked');
  assert.equal(attempt.reason, 'email-has-account');
});

/* ── The shell ───────────────────────────────────────────────────────────────────────────── */

test('account pages carry the Nova design, not a second one', async (t) => {
  const site = await createSite(t);
  const html = await browser(site).get('/account/sign-in').then((r) => r.text());

  assert.match(html, /assets\/nova\.css/, 'the site stylesheet');
  assert.match(html, /assets\/account\.css/, 'and the account extension');
  assert.match(html, /class="masthead"/, 'the site masthead');
  assert.match(html, /class="wrap masthead-inner"/);
  assert.match(html, /site-footer/, 'the site footer');
  assert.match(html, /btn btn-primary/, 'the site button classes');
  assert.match(html, /noindex/, 'account pages are not for search engines');
});

test('every account page says the account is for the whole ecosystem', async (t) => {
  const site = await createSite(t);
  for (const path of ['/account/sign-in', '/account/new', '/account/forgot']) {
    const html = await browser(site).get(path).then((r) => r.text());
    assert.match(html, /One Nova Account works across Nova/i, path);
    assert.match(html, /nova\.help/i, `${path} names Nova.Help`);
  }
});

test('what a stranger types is escaped, not rendered', async (t) => {
  const site = await createSite(t);
  const nasty = '"><script>alert(1)</script>';
  const response = await browser(site).post('/account/sign-in', { email: nasty, password: '' });
  const html = await response.text();

  assert.equal(html.includes('<script>alert(1)</script>'), false, 'not rendered as markup');
  assert.match(html, /&lt;script&gt;/, 'escaped instead');
});
