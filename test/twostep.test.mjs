/**
 * Two-step verification on the Nova site -- driven through the real router, a real SQLite engine
 * behind D1, and Nova's real schema (including the `account_mfa` table).
 *
 * The package tests (NovaHelp/test/mfa.test.mjs) prove the rules. These prove the front door
 * applies them, and above all that NO ROUTE HANDS OUT A SESSION WITHOUT THE CODE:
 *
 *   - a correct password lands on the second step, and no session cookie is set there
 *   - the reset-by-email link does not sign an enrolled account in
 *   - turning two-step off, or replacing recovery codes, cannot be done on a session alone
 *   - nothing secret (the key, the codes) is anywhere but the one page that shows it
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { base32Decode, hotp, stepAt } from '../packages/nova-accounts/totp.mjs';
import { browser, createSite, NEW_PASSWORD, PASSWORD, tokenFrom } from './helpers/harness.mjs';

const SESSION_COOKIE = 'nova_session';

async function signUp(site, email = 'ann@example.com') {
  const b = browser(site);
  const created = await b.post('/account/new', { email, displayName: 'Ann', password: PASSWORD, passwordConfirm: PASSWORD });
  assert.equal(created.status, 303, await created.text());
  const id = await site.db.prepare('SELECT id FROM accounts WHERE email_normalized = ?').bind(email).first('id');
  return { b, id, email };
}

const keyFrom = (page) => base32Decode(/class="qr-key">([^<]+)</.exec(page)[1]);
const codesFrom = (page) => [...page.matchAll(/<li><code>([^<]+)<\/code><\/li>/g)].map((m) => m[1]);
/** A valid code for the step AFTER this one: in the window, and past anything already spent. */
const nextCode = (secret, ahead = 1) => hotp(secret, stepAt() + ahead);

/** Run the whole setup through the pages. Returns the key and the recovery codes. */
async function turnOn(b, id) {
  const start = await b.post('/account/security/two-step/start', { currentPassword: PASSWORD });
  assert.equal(start.status, 303);
  assert.equal(start.headers.get('location'), '/account/security/two-step');

  const setup = await (await b.get('/account/security/two-step')).text();
  const secret = keyFrom(setup);
  const confirm = await b.post('/account/security/two-step/confirm', { code: hotp(secret, stepAt()) });
  assert.equal(confirm.status, 200);
  return { secret, codes: codesFrom(await confirm.text()) };
}

test('the Security page offers it, and the setup page asks for the password first', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);

  const security = await (await b.get('/account/security')).text();
  assert.match(security, /Set up two-step verification/);
  assert.match(security, /authenticator app/);

  const intro = await (await b.get('/account/security/two-step')).text();
  assert.match(intro, /Secure your Nova Account/);
  assert.match(intro, /Add an extra layer of protection to your account using an authenticator app/);
  for (const app of ['Google Authenticator', 'Apple Passwords', 'Microsoft Authenticator', 'Samsung-compatible']) {
    assert.ok(intro.includes(app), app);
  }
  assert.ok(!/<svg[^>]*aria-label="QR/.test(intro), 'no QR code is drawn before the password is given');

  const wrong = await b.post('/account/security/two-step/start', { currentPassword: 'nope' });
  assert.equal(wrong.status, 403);
  assert.ok(!/<svg[^>]*aria-label="QR/.test(await wrong.text()));
});

test('setup shows a scannable code and a typed key, and is NOT on until a real code is entered', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);

  await b.post('/account/security/two-step/start', { currentPassword: PASSWORD });
  const setup = await (await b.get('/account/security/two-step')).text();
  assert.match(setup, /<svg[^>]*aria-label="QR code to add your Nova Account/);
  assert.match(setup, /Scan the QR code/);
  assert.match(setup, /class="qr-key">[A-Z2-7 ]+</);

  assert.equal(Number(await site.db.prepare('SELECT COUNT(*) AS n FROM account_mfa').first('n')), 1, 'a pending row exists');
  const status = await (await b.get('/account/security')).text();
  assert.match(status, /Set up two-step verification/, 'but the account does not say it is protected');

  const bad = await b.post('/account/security/two-step/confirm', { code: '000000' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /That code is not right/);
  assert.match(await (await b.get('/account/security')).text(), /Set up two-step verification/, 'still off');

  // A fresh browser (no session) still signs in with the password alone: nothing is on yet.
  const other = browser(site);
  assert.equal((await other.post('/account/sign-in', { email, password: PASSWORD })).status, 303);
});

test('confirming shows ten recovery codes once, and turns the Security page to "on"', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  const { codes } = await turnOn(b, id);

  assert.equal(codes.length, 10);
  assert.ok(codes.every((c) => /^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(c)));

  const security = await (await b.get('/account/security')).text();
  assert.match(security, /Manage two-step verification/);
  assert.match(security, /<strong>10<\/strong> recovery codes/);
  assert.ok(codes.every((c) => !security.includes(c)), 'the codes are never shown again');

  const manage = await (await b.get('/account/security/two-step')).text();
  assert.ok(codes.every((c) => !manage.includes(c)), 'nor on the manage page');
  assert.ok(!/qr-key/.test(manage) && !/aria-label="QR/.test(manage), 'nor the key or the QR code');

  const row = await site.db.prepare('SELECT data FROM account_mfa WHERE account_id = ?').bind(id).first('data');
  assert.ok(codes.every((c) => !row.includes(c) && !row.includes(c.replace('-', ''))), 'and not in the database either');
  assert.ok(!/"sealed":"[^v]/.test(row), 'the secret is stored sealed');
});

test('the recovery-codes page and the setup page are never cached', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);
  await b.post('/account/security/two-step/start', { currentPassword: PASSWORD });
  const setup = await b.get('/account/security/two-step');
  assert.match(setup.headers.get('cache-control'), /no-store/);
  const secret = keyFrom(await setup.text());
  const done = await b.post('/account/security/two-step/confirm', { code: hotp(secret, stepAt()) });
  assert.match(done.headers.get('cache-control'), /no-store/);
});

test('a correct password lands on the second step, and no session exists until the code is right', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const { secret } = await turnOn(b, id);

  const fresh = browser(site);
  const first = await fresh.post('/account/sign-in', { email, password: PASSWORD });
  assert.equal(first.status, 200, 'not a redirect into the account');
  assert.ok(!fresh.jar.has(SESSION_COOKIE), 'and no session cookie was set');
  const page = await first.text();
  assert.match(page, /Authentication code/);
  const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];

  // The account area is still closed to this browser.
  assert.equal((await fresh.get('/account')).status, 303);

  const wrong = await fresh.post('/account/sign-in/verify', { ticket, code: '000000' });
  assert.equal(wrong.status, 401);
  assert.ok(!fresh.jar.has(SESSION_COOKIE));
  assert.match(await wrong.text(), /That code is not right/);

  const right = await fresh.post('/account/sign-in/verify', { ticket, code: nextCode(secret) });
  assert.equal(right.status, 303);
  assert.equal(right.headers.get('location'), '/account?welcome=signed-in');
  assert.ok(fresh.jar.has(SESSION_COOKIE), 'now there is a session');
  assert.equal((await fresh.get('/account')).status, 200);
});

test('a wrong password never reaches the second step', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  await turnOn(b, id);
  const fresh = browser(site);
  const attempt = await fresh.post('/account/sign-in', { email, password: 'wrong wrong wrong' });
  assert.equal(attempt.status, 401);
  assert.ok(!/Authentication code/.test(await attempt.text()));
});

test('the verify step cannot be reached with a forged, edited or foreign ticket', async (t) => {
  const site = await createSite(t);
  const a = await signUp(site, 'a@example.com');
  const bb = await signUp(site, 'b@example.com');
  const { secret } = await turnOn(a.b, a.id);
  await turnOn(bb.b, bb.id);

  const visitor = browser(site);
  const page = await (await visitor.post('/account/sign-in', { email: 'a@example.com', password: PASSWORD })).text();
  const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];

  for (const forged of ['', 'x', `${bb.id}.9999999999.AAAA`, ticket.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), `${bb.id}.${ticket.split('.').slice(1).join('.')}`]) {
    const r = await visitor.post('/account/sign-in/verify', { ticket: forged, code: nextCode(secret) });
    assert.equal(r.status, 401, forged);
    assert.ok(!visitor.jar.has(SESSION_COOKIE), forged);
  }
  assert.equal((await visitor.get('/account/sign-in/verify')).status, 303, 'GET goes back to the start');
});

test('five wrong codes lock the second step, even for the right code, across tickets', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const { secret } = await turnOn(b, id);

  const v = browser(site);
  let last;
  for (let i = 0; i < 5; i += 1) {
    const page = await (await v.post('/account/sign-in', { email, password: PASSWORD })).text();
    const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];
    last = await v.post('/account/sign-in/verify', { ticket, code: '000000' });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);

  const page = await (await v.post('/account/sign-in', { email, password: PASSWORD })).text();
  const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];
  const locked = await v.post('/account/sign-in/verify', { ticket, code: nextCode(secret) });
  assert.equal(locked.status, 429);
  assert.ok(!v.jar.has(SESSION_COOKIE));
});

test('a recovery code signs in once and only once', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const { codes } = await turnOn(b, id);

  const signIn = async (code) => {
    const v = browser(site);
    const page = await (await v.post('/account/sign-in', { email, password: PASSWORD })).text();
    const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];
    return { v, response: await v.post('/account/sign-in/verify', { ticket, code }) };
  };

  const first = await signIn(codes[0]);
  assert.equal(first.response.status, 303);
  assert.ok(first.v.jar.has(SESSION_COOKIE));
  assert.ok(site.mailer.sent.some((m) => /recovery code was used/.test(m.subject)), 'the owner is told');

  const again = await signIn(codes[0]);
  assert.equal(again.response.status, 401);
  assert.ok(!again.v.jar.has(SESSION_COOKIE));
  assert.equal((await signIn(codes[1])).response.status, 303);
});

test('next= survives the second step, and an off-site next is refused', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const { secret } = await turnOn(b, id);

  const v = browser(site);
  const page = await (await v.post('/account/sign-in', { email, password: PASSWORD, next: '/account/security' })).text();
  const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];
  assert.match(page, /name="next" value="\/account\/security"/);
  const done = await v.post('/account/sign-in/verify', { ticket, code: nextCode(secret), next: '/account/security' });
  assert.equal(done.headers.get('location'), '/account/security');

  const w = browser(site);
  const page2 = await (await w.post('/account/sign-in', { email, password: PASSWORD })).text();
  const ticket2 = /name="ticket" value="([^"]+)"/.exec(page2)[1];
  const away = await w.post('/account/sign-in/verify', { ticket: ticket2, code: nextCode(secret, 0) === nextCode(secret) ? nextCode(secret, -1) : nextCode(secret, 0), next: 'https://evil.example/' });
  // Whether the code is accepted is beside the point (it is a spent step); where it would go is not.
  assert.ok(!(away.headers.get('location') ?? '').startsWith('https://evil.example'));
});

test('a password-reset link does NOT sign an enrolled account in', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  await turnOn(b, id);

  const anon = browser(site);
  await anon.post('/account/forgot', { email });
  const token = tokenFrom(site.mailer);
  const reset = await anon.post('/account/reset', { token, password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD });
  assert.equal(reset.status, 303);
  assert.equal(reset.headers.get('location'), '/account/sign-in?reset=done');
  assert.ok(!anon.jar.has(SESSION_COOKIE), 'the mailbox alone is not the second factor');

  const page = await (await anon.get('/account/sign-in?reset=done')).text();
  assert.match(page, /Your password has been changed/);

  // The new password works, and then still asks for the code.
  const again = await anon.post('/account/sign-in', { email, password: NEW_PASSWORD });
  assert.equal(again.status, 200);
  assert.match(await again.text(), /Authentication code/);
});

test('a reset for an account WITHOUT two-step still signs in as before', async (t) => {
  const site = await createSite(t);
  const { email } = await signUp(site);
  const anon = browser(site);
  await anon.post('/account/forgot', { email });
  const reset = await anon.post('/account/reset', { token: tokenFrom(site.mailer), password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD });
  assert.equal(reset.headers.get('location'), '/account?welcome=password-reset');
  assert.ok(anon.jar.has(SESSION_COOKIE));
});

test('a stolen session cannot turn two-step off or replace the codes without the password AND a code', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  const { secret, codes } = await turnOn(b, id);

  for (const path of ['/account/security/two-step/disable', '/account/security/two-step/recovery']) {
    const bare = await b.post(path, {});
    assert.equal(bare.status, 403, path);
    const passwordOnly = await b.post(path, { currentPassword: PASSWORD });
    assert.equal(passwordOnly.status, 403, path);
    const codeOnly = await b.post(path, { code: hotp(secret, stepAt() + 1) });
    assert.equal(codeOnly.status, 403, path);
  }
  assert.match(await (await b.get('/account/security')).text(), /Manage two-step verification/, 'still on');

  // GET never changes anything.
  const get = await b.get('/account/security/two-step/disable');
  assert.ok(get.status === 404 || get.status === 303 || get.status === 200);
  assert.match(await (await b.get('/account/security')).text(), /Manage two-step verification/);

  const off = await b.post('/account/security/two-step/disable', { currentPassword: PASSWORD, code: codes[0] });
  assert.equal(off.status, 303);
  assert.equal(off.headers.get('location'), '/account/security?done=two-step-off');
  assert.match(await (await b.get('/account/security')).text(), /Set up two-step verification/);
  assert.ok(site.mailer.sent.some((m) => /OFF/.test(m.subject)));

  // And now a password alone signs in again.
  const v = browser(site);
  assert.equal((await v.post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD })).status, 303);
});

test('new recovery codes need both proofs, replace the old set, and are shown once', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  const { secret, codes } = await turnOn(b, id);

  const made = await b.post('/account/security/two-step/recovery', { currentPassword: PASSWORD, code: codes[0] });
  assert.equal(made.status, 200);
  const fresh = codesFrom(await made.text());
  assert.equal(fresh.length, 10);
  assert.ok(fresh.every((c) => !codes.includes(c)));
  assert.match(await (await b.get('/account/security')).text(), /<strong>10<\/strong> recovery codes/);
  assert.ok(site.mailer.sent.some((m) => /recovery codes .* replaced/.test(m.subject)));

  const v = browser(site);
  const page = await (await v.post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD })).text();
  const ticket = /name="ticket" value="([^"]+)"/.exec(page)[1];
  assert.equal((await v.post('/account/sign-in/verify', { ticket, code: codes[1] })).status, 401, 'an old code is dead');
  assert.equal((await v.post('/account/sign-in/verify', { ticket, code: fresh[0] })).status, 303);
  void secret;
});

test('turning two-step on or off signs every OTHER device out and keeps this one', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const other = browser(site);
  assert.equal((await other.post('/account/sign-in', { email, password: PASSWORD })).status, 303);
  assert.equal((await other.get('/account')).status, 200);

  const { codes } = await turnOn(b, id);
  assert.equal((await other.get('/account')).status, 303, 'the other device was signed out by enabling');
  assert.equal((await b.get('/account')).status, 200, 'this one stays');

  const v = browser(site);
  const page = await (await v.post('/account/sign-in', { email, password: PASSWORD })).text();
  await v.post('/account/sign-in/verify', { ticket: /name="ticket" value="([^"]+)"/.exec(page)[1], code: codes[0] });
  assert.equal((await v.get('/account')).status, 200);

  await b.post('/account/security/two-step/disable', { currentPassword: PASSWORD, code: codes[1] });
  assert.equal((await v.get('/account')).status, 303, 'and disabling signs the others out again');
  assert.equal((await b.get('/account')).status, 200);
});

test('setup can be cancelled, and nobody signed out reaches any two-step route', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);
  await b.post('/account/security/two-step/start', { currentPassword: PASSWORD });
  const cancelled = await b.post('/account/security/two-step/cancel', {});
  assert.equal(cancelled.status, 303);
  assert.equal(Number(await site.db.prepare('SELECT COUNT(*) AS n FROM account_mfa').first('n')), 0);

  const stranger = browser(site);
  for (const path of ['/account/security/two-step']) {
    assert.equal((await stranger.get(path)).status, 303);
  }
  for (const path of ['start', 'confirm', 'cancel', 'disable', 'recovery']) {
    const r = await stranger.post(`/account/security/two-step/${path}`, { currentPassword: PASSWORD, code: '123456' });
    assert.equal(r.status, 303, path);
    assert.match(r.headers.get('location'), /^\/account\/sign-in/, path);
  }
});

test('deleting the account removes the two-step record with it', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  await turnOn(b, id);
  const gone = await b.post('/account/delete', { currentPassword: PASSWORD, confirmEmail: email, understand: 'yes' });
  assert.equal(gone.status, 303);
  assert.equal(Number(await site.db.prepare('SELECT COUNT(*) AS n FROM account_mfa WHERE account_id = ?').bind(id).first('n')), 0);
});

test('a deployment that has not run the migration yet still signs people in', async (t) => {
  const site = await createSite(t);
  const { email } = await signUp(site);
  await site.db.prepare('DROP TABLE account_mfa').run();
  const v = browser(site);
  assert.equal((await v.post('/account/sign-in', { email, password: PASSWORD })).status, 303, 'nobody can be enrolled without the table');
});
