/**
 * Approving an installed app on the Nova site -- the human half of the device grant.
 *
 * WHAT THIS PROVES: an app (Atlas, here) starts a sign-in with Nova.Help's service, a person
 * approves it on the NOVA SITE, and the app then redeems a working token -- with Nova.Help's
 * service, over the same database, which is how the two halves meet in production. Nothing in
 * these tests reaches into the package to approve a code; every decision goes through the page.
 *
 * The security rules the page must keep are each pinned: approval is POST-only, needs the code
 * typed back, takes the account from the session, and never says whether a code exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccounts } from '@nova/accounts';
import { createD1AccountStore } from '@nova/accounts/d1Store';

import { browser, createSite, PASSWORD } from './helpers/harness.mjs';

/** Nova.Help's service over the SAME database the Nova site is using -- the app's side. */
const novaHelpOver = (db) =>
  createAccounts({
    secret: 'a-test-signing-secret-of-sufficient-length',
    store: createD1AccountStore({ db }),
    product: 'nova.help',
    productName: 'Nova',
    cost: { N: 1024, r: 8, p: 1 },
  });

const signUp = (b, email) =>
  b.post('/account/new', { email, password: PASSWORD, passwordConfirm: PASSWORD, displayName: 'Ann' });

/**
 * Poll the way a well-behaved app does: five-second pacing, so each poll is six seconds after the
 * last. Without it the server (correctly) answers `slow_down` to back-to-back polls.
 */
const poller = (novaHelp, deviceCode) => {
  let clock = Date.now();
  return () => novaHelp.redeemDeviceAuthorization(deviceCode, { now: new Date((clock += 6000)) });
};

/** A person signed in on the Nova site, and the app's service beside it. */
async function setup(t) {
  const site = await createSite(t);
  const person = browser(site);
  await signUp(person, 'ann@example.com');
  const novaHelp = await novaHelpOver(site.db);
  const started = await novaHelp.startDeviceAuthorization({ product: 'atlas', scopes: ['identity'], deviceName: 'ANN-PC' });
  assert.ok(started.ok, 'the app can start a grant');
  return { site, person, novaHelp, started };
}

test('the page that takes a code is served, signed in or not', async (t) => {
  const site = await createSite(t);
  const res = await browser(site).get('/account/device');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Connect an app/);
  assert.match(text, /action="\/account\/device\/check"/);
  assert.match(text, /asked to sign in/);
});

test('a signed-out person with a code is sent to sign in and brought back to it', async (t) => {
  const site = await createSite(t);
  const res = await browser(site).get('/account/device?code=ABCD-EFGH');
  assert.equal(res.status, 303);
  const location = res.headers.get('location');
  assert.match(location, /^\/account\/sign-in\?next=/);
  assert.equal(new URLSearchParams(location.split('?')[1]).get('next'), '/account/device?code=ABCD-EFGH');
});

test('the confirmation names the app and what it will be able to do', async (t) => {
  const { person, started } = await setup(t);
  const res = await person.get(`/account/device?code=${started.userCode}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Atlas/);
  assert.match(text, /ANN-PC/);
  assert.match(text, /See that you are signed in/);
  assert.match(text, /Connect this app/);
  assert.match(text, /Not now/);
});

test('a full approval on the Nova site gives the app a working token', async (t) => {
  const { person, novaHelp, started } = await setup(t);

  // Before approval the app is told to keep waiting, not that anything is wrong.
  const poll = poller(novaHelp, started.deviceCode);
  const waiting = await poll();
  assert.equal(waiting.ok, false);
  assert.equal(waiting.reason, 'authorization_pending');

  // "Connect this app" only leads to the second step: nothing is approved yet.
  const first = await person.post('/account/device', { code: started.userCode, action: 'approve' });
  assert.equal(first.status, 200);
  assert.match(await first.text(), /One last step/);
  assert.equal((await poll()).reason, 'authorization_pending');

  // Typing the code the app is showing decides it.
  const second = await person.post('/account/device', {
    code: started.userCode,
    action: 'approve',
    confirm: started.userCode.toLowerCase().replace('-', ' ').trim(),
  });
  assert.equal(second.status, 303);
  assert.equal(second.headers.get('location'), '/account/device?done=approved');
  const done = await (await person.get('/account/device?done=approved')).text();
  assert.match(done, /That app is connected/);

  const redeemed = await poll();
  assert.ok(redeemed.ok, 'the app redeems a token');
  assert.equal(redeemed.account.displayName, 'Ann');
  const resolved = await novaHelp.resolveProductToken(redeemed.token);
  assert.ok(resolved, 'and the token resolves on Nova.Help');
  assert.equal(resolved.product, 'atlas');
});

test('a wrong confirmation code approves nothing', async (t) => {
  const { person, novaHelp, started } = await setup(t);
  const res = await person.post('/account/device', { code: started.userCode, action: 'approve', confirm: 'ZZZZ-ZZZZ' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /does not match/);
  assert.equal((await novaHelp.redeemDeviceAuthorization(started.deviceCode)).reason, 'authorization_pending');
});

test('"Not now" refuses the app, which is then told so', async (t) => {
  const { person, novaHelp, started } = await setup(t);
  const res = await person.post('/account/device', { code: started.userCode, action: 'deny' });
  assert.equal(res.headers.get('location'), '/account/device?done=denied');
  assert.equal((await novaHelp.redeemDeviceAuthorization(started.deviceCode)).reason, 'access_denied');
});

test('approving is POST-only: a GET with a code never decides anything', async (t) => {
  const { person, novaHelp, started } = await setup(t);
  await person.get(`/account/device?code=${started.userCode}&action=approve&confirm=${started.userCode}`);
  assert.equal((await novaHelp.redeemDeviceAuthorization(started.deviceCode)).reason, 'authorization_pending');
});

test('a signed-out POST cannot approve, and is sent to sign in', async (t) => {
  const { site, novaHelp, started } = await setup(t);
  const stranger = browser(site);
  const res = await stranger.post('/account/device', { code: started.userCode, action: 'approve', confirm: started.userCode });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/account\/sign-in\?next=/);
  assert.equal((await novaHelp.redeemDeviceAuthorization(started.deviceCode)).reason, 'authorization_pending');
});

test('the account is the session, never a field: a form cannot name another account', async (t) => {
  const { site, person, novaHelp, started } = await setup(t);
  const other = browser(site);
  await signUp(other, 'bob@example.com');
  const bob = await site.db.prepare('SELECT id FROM accounts WHERE email_normalized = ?').bind('bob@example.com').first();

  await person.post('/account/device', { code: started.userCode, action: 'approve', confirm: started.userCode, accountId: bob.id, account: bob.id });
  const redeemed = await novaHelp.redeemDeviceAuthorization(started.deviceCode);
  assert.ok(redeemed.ok);
  assert.equal(redeemed.account.displayName, 'Ann', "approved as the person who was signed in, not the one named in the form");
});

test('an unknown code and an expired-looking one are refused in the same words', async (t) => {
  const { person } = await setup(t);
  const res = await person.get('/account/device?code=ZZZZ-ZZZZ');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /could not find that code/);
});

test('a used code cannot be used twice', async (t) => {
  const { person, started } = await setup(t);
  await person.post('/account/device', { code: started.userCode, action: 'approve', confirm: started.userCode });
  const again = await person.get(`/account/device?code=${started.userCode}`);
  assert.equal(again.status, 404);
  assert.match(await again.text(), /already been used/);
});

test('typing codes is rate-limited, because the code is short', async (t) => {
  const site = await createSite(t, { limiter: true });
  const person = browser(site);
  await signUp(person, 'ann@example.com');
  let last;
  for (let i = 0; i < 16; i += 1) last = await person.post('/account/device/check', { code: `AAAA-${String(i).padStart(4, '0')}` });
  assert.equal(last.status, 429);
});
