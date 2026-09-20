/**
 * Managing a Nova Account from the Nova site: profile, picture, email, password, security, and
 * deletion -- driven through the real router, a real SQLite engine behind D1, Nova.Help's real
 * schema (tickets included), and a fake R2 bucket.
 *
 * The tests that matter most are about what must NOT happen:
 *
 *   - nobody who is signed out reaches any of it, and a GET never changes anything
 *   - a stolen session alone cannot change the address or password or delete the account
 *   - a picture is only ever a real PNG, JPEG or WebP, judged by its bytes, under a key we made
 *   - deleting an account anonymises its tickets IN THE SAME TRANSACTION, keeps everything that is
 *     support history, and cannot be used to reach anybody else's tickets
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { browser, createSite, NEW_PASSWORD, PASSWORD } from './helpers/harness.mjs';

/* ── Fixtures ────────────────────────────────────────────────────────────────────────────── */

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s) => [...s].map((c) => c.charCodeAt(0));
const pad = (bytes, to = 96) => Uint8Array.from([...bytes, ...new Array(Math.max(0, to - bytes.length)).fill(0)]);
const png = (w = 64, h = 64) => pad([0x89, ...text('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
const webp = () => pad([...text('RIFF'), 50, 0, 0, 0, ...text('WEBP'), ...text('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 63, 0, 0]);

async function signUp(site, email = 'ann@example.com', displayName = 'Ann') {
  const b = browser(site);
  const created = await b.post('/account/new', { email, displayName, password: PASSWORD, passwordConfirm: PASSWORD });
  assert.equal(created.status, 303, await created.text());
  const row = await site.db.prepare('SELECT id FROM accounts WHERE email_normalized = ?').bind(email).first();
  return { b, id: row.id, email };
}

const signInAgain = async (site, email, password = PASSWORD) => {
  const b = browser(site);
  const response = await b.post('/account/sign-in', { email, password });
  assert.equal(response.status, 303, 'sign-in succeeds');
  return b;
};

const count = async (site, sql, ...values) => Number(await site.db.prepare(sql).bind(...values).first('n'));

const MANAGEMENT_PAGES = ['/account/profile', '/account/email', '/account/password', '/account/security', '/account/delete'];

/* ── Signed out ──────────────────────────────────────────────────────────────────────────── */

test('nobody who is signed out reaches any management page, and nothing is changed', async (t) => {
  const site = await createSite(t);
  const stranger = browser(site);
  for (const path of MANAGEMENT_PAGES) {
    const page = await stranger.get(path);
    assert.equal(page.status, 303, path);
    assert.match(page.headers.get('location'), /^\/account\/sign-in/, path);
  }
  for (const path of ['/account/profile', '/account/email', '/account/password', '/account/delete', '/account/avatar', '/account/avatar/remove', '/account/security/sign-out-others']) {
    const post = await stranger.post(path, { displayName: 'x', newEmail: 'x@example.com', currentPassword: 'x' });
    assert.equal(post.status, 303, path);
    assert.match(post.headers.get('location'), /^\/account\/sign-in/, path);
  }
  assert.equal((await stranger.get('/account/avatar')).status, 303);
});

test('a GET never changes anything: the state-changing routes do not answer to GET', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  const other = await signInAgain(site, 'ann@example.com');

  for (const path of ['/account/avatar/remove', '/account/security/sign-out-others', '/account/security/revoke']) {
    const response = await b.get(path);
    assert.equal(response.status, 404, `${path} does not answer to GET`);
  }
  assert.equal((await other.get('/account/security')).status, 200, 'the other session is still alive');
  assert.equal(await count(site, 'SELECT COUNT(*) AS n FROM account_sessions WHERE account_id = ?', id), 2);
});

/* ── Profile ─────────────────────────────────────────────────────────────────────────────── */

test('the name can be changed from the profile page, and is bounded', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);

  const page = await b.get('/account/profile');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Profile picture/);

  assert.equal((await b.post('/account/profile', { displayName: 'Ann Marie' })).headers.get('location'), '/account/profile?done=name');
  assert.equal((await site.db.prepare('SELECT display_name AS n FROM accounts WHERE id = ?').bind(id).first('n')), 'Ann Marie');

  const tooLong = await b.post('/account/profile', { displayName: 'x'.repeat(81) });
  assert.equal(tooLong.status, 400);
  assert.equal((await site.db.prepare('SELECT display_name AS n FROM accounts WHERE id = ?').bind(id).first('n')), 'Ann Marie', 'unchanged');
});

/* ── Picture ─────────────────────────────────────────────────────────────────────────────── */

test('a picture is stored in R2 under a key we made, referenced in the database, and served back safely', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);

  // The filename tries to traverse, and the browser claims the wrong type: neither is consulted.
  const up = await b.upload('/account/avatar', png(), { filename: '../../tickets/abc/evil.html', claimedType: 'text/html' });
  assert.equal(up.status, 303, await up.text());
  assert.equal(up.headers.get('location'), '/account/profile?done=avatar');

  const keys = [...site.env.AVATARS.objects.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], new RegExp(`^avatars/${id}/[0-9a-f]{48}$`), 'a generated key, nothing from the request');
  assert.equal(site.env.AVATARS.objects.get(keys[0]).httpMetadata.contentType, 'image/png', 'the type came from the bytes');

  const row = await site.db.prepare('SELECT * FROM account_avatars WHERE account_id = ?').bind(id).first();
  assert.equal(row.object_key, keys[0]);
  assert.equal(row.content_type, 'image/png');
  assert.equal(await count(site, "SELECT COUNT(*) AS n FROM accounts WHERE length(email) > 0 AND id = ?", id), 1, 'the shared accounts row is untouched');

  const served = await b.get('/account/avatar');
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /default-src 'none'/);
  assert.deepEqual([...new Uint8Array(await served.arrayBuffer())], [...png()]);

  assert.match(await (await b.get('/account')).text(), /src="\/account\/avatar\?v=/, 'the overview shows it');
});

test('changing the picture removes the old object, and removing it removes object and row', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);

  await b.upload('/account/avatar', png());
  const first = [...site.env.AVATARS.objects.keys()][0];
  await b.upload('/account/avatar', webp(), { filename: 'me.webp', claimedType: 'image/webp' });
  const keys = [...site.env.AVATARS.objects.keys()];
  assert.equal(keys.length, 1, 'only the new object remains');
  assert.notEqual(keys[0], first);
  assert.equal(site.env.AVATARS.objects.get(keys[0]).httpMetadata.contentType, 'image/webp');

  assert.equal((await b.post('/account/avatar/remove', {})).headers.get('location'), '/account/profile?done=avatar-removed');
  assert.equal(site.env.AVATARS.objects.size, 0);
  assert.equal(await count(site, 'SELECT COUNT(*) AS n FROM account_avatars WHERE account_id = ?', id), 0);
  assert.equal((await b.get('/account/avatar')).status, 404);
});

test('what is not a real PNG, JPEG or WebP is refused, whatever it claims to be', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);
  const enc = new TextEncoder();

  for (const [label, bytes, filename, claimedType] of [
    ['html as png', pad([...enc.encode('<!doctype html><script>alert(1)</script>')]), 'me.png', 'image/png'],
    ['svg as png', pad([...enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')]), 'me.png', 'image/png'],
    ['gif as png', pad([...text('GIF89a'), 1, 0, 1, 0]), 'me.png', 'image/png'],
    ['exe as jpg', pad([0x4d, 0x5a, 0x90, 0]), 'me.jpg', 'image/jpeg'],
    ['huge dimensions', png(9000, 9000), 'me.png', 'image/png'],
  ]) {
    const response = await b.upload('/account/avatar', bytes, { filename, claimedType });
    assert.equal(response.status, 400, label);
  }
  assert.equal(site.env.AVATARS.objects.size, 0, 'nothing was stored');
});

test('an oversized upload is refused from its declared size, before it is read', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);
  const big = new Uint8Array(400 * 1024);
  big.set(png());
  const response = await b.upload('/account/avatar', big);
  assert.equal(response.status, 413);
  assert.equal(site.env.AVATARS.objects.size, 0);

  // A request that does not declare a size at all is refused too, rather than trusted.
  const undeclared = await b.upload('/account/avatar', png(), { headers: { 'content-length': '' } });
  assert.equal(undeclared.status, 413);
});

test('a person only ever fetches their OWN picture, and cannot name another', async (t) => {
  const site = await createSite(t);
  const ann = await signUp(site, 'ann@example.com');
  const bob = await signUp(site, 'bob@example.com', 'Bob');
  await ann.b.upload('/account/avatar', png());

  assert.equal((await bob.b.get('/account/avatar')).status, 404, 'bob has none, and cannot see ann\'s');
  assert.equal((await bob.b.get(`/account/avatar?id=${ann.id}`)).status, 404, 'a query string names nobody');
  assert.equal((await ann.b.get('/account/avatar')).status, 200);
});

test('a row pointing outside the picture keys never causes anything else to be read or deleted', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  await site.env.AVATARS.put('tickets/T-1/attachment', new Uint8Array([1, 2, 3]));
  // A corrupted/forged row aimed at a ticket attachment.
  await site.db
    .prepare('INSERT INTO account_avatars (account_id, object_key, content_type, size, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, 'tickets/T-1/attachment', 'image/png', 3, new Date().toISOString())
    .run();

  assert.equal((await b.get('/account/avatar')).status, 404, 'it is not served');
  await b.post('/account/avatar/remove', {});
  assert.ok(site.env.AVATARS.objects.has('tickets/T-1/attachment'), 'and it is not deleted');
});

test('without the R2 binding the page says so honestly and uploads are refused', async (t) => {
  const site = await createSite(t, { bucket: false });
  const { b } = await signUp(site);
  assert.match(await (await b.get('/account/profile')).text(), /Profile pictures are not available yet/);
  assert.equal((await b.upload('/account/avatar', png())).status, 503);
});

/* ── Email ───────────────────────────────────────────────────────────────────────────────── */

test('changing the address needs the password, and moves sign-in to the new one', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  await signUp(site, 'bob@example.com');

  assert.equal((await b.get('/account/email')).status, 200);

  const wrong = await b.post('/account/email', { newEmail: 'ann2@example.com', currentPassword: 'wrong' });
  assert.equal(wrong.status, 403);
  assert.match(await wrong.text(), /not your current password/);

  const taken = await b.post('/account/email', { newEmail: 'bob@example.com', currentPassword: PASSWORD });
  assert.equal(taken.status, 400);
  assert.match(await taken.text(), /already used by another Nova Account/);

  assert.equal((await site.db.prepare('SELECT email AS e FROM accounts WHERE id = ?').bind(id).first('e')), 'ann@example.com', 'refusals change nothing');

  const done = await b.post('/account/email', { newEmail: 'ann.new@example.com', currentPassword: PASSWORD });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account?updated=email');
  assert.match(await (await b.get('/account?updated=email')).text(), /email address has been changed/);

  assert.equal((await site.db.prepare('SELECT email_verified AS v FROM accounts WHERE id = ?').bind(id).first('v')), 0, 'the new address starts unverified');
  const told = site.mailer.sent.at(-1);
  assert.equal(told.to, 'ann@example.com', 'the OLD address is told');
});

test('the old address stops signing in and the new one starts', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);
  await b.post('/account/email', { newEmail: 'ann.new@example.com', currentPassword: PASSWORD });

  const oldTry = await browser(site).post('/account/sign-in', { email: 'ann@example.com', password: PASSWORD });
  assert.notEqual(oldTry.status, 303, 'the old address is refused');
  const newTry = await browser(site).post('/account/sign-in', { email: 'ann.new@example.com', password: PASSWORD });
  assert.equal(newTry.status, 303);
});

/* ── Password ────────────────────────────────────────────────────────────────────────────── */

test('changing the password needs the current one, keeps this device, and signs every other out', async (t) => {
  const site = await createSite(t);
  const { b, email } = await signUp(site);
  const phone = await signInAgain(site, email);

  const wrong = await b.post('/account/password', { currentPassword: 'wrong', password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD });
  assert.equal(wrong.status, 403);
  const weak = await b.post('/account/password', { currentPassword: PASSWORD, password: 'short', passwordConfirm: 'short' });
  assert.equal(weak.status, 400);
  const mismatch = await b.post('/account/password', { currentPassword: PASSWORD, password: NEW_PASSWORD, passwordConfirm: 'different' });
  assert.equal(mismatch.status, 400);
  assert.equal((await phone.get('/account')).status, 200, 'refusals sign nobody out');

  const done = await b.post('/account/password', { currentPassword: PASSWORD, password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account/security?done=password');

  assert.equal((await b.get('/account')).status, 200, 'this device is still signed in');
  assert.equal((await phone.get('/account')).status, 303, 'every other device is signed out');
  assert.notEqual((await browser(site).post('/account/sign-in', { email, password: PASSWORD })).status, 303, 'the old password is dead');
  assert.equal((await browser(site).post('/account/sign-in', { email, password: NEW_PASSWORD })).status, 303);
  assert.match(site.mailer.sent.at(-1).subject, /password was changed/);
});

test('no page ever echoes a password back', async (t) => {
  const site = await createSite(t);
  const { b } = await signUp(site);
  const response = await b.post('/account/password', { currentPassword: 'CURRENT-secret-value', password: 'NEW-secret-value-1', passwordConfirm: 'mismatch-secret-2' });
  const page = await response.text();
  for (const secret of ['CURRENT-secret-value', 'NEW-secret-value-1', 'mismatch-secret-2']) assert.ok(!page.includes(secret), secret);
});

/* ── Security ────────────────────────────────────────────────────────────────────────────── */

test('the security page lists sign-ins, ends one, and signs out the rest', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const phone = await signInAgain(site, email);
  await signInAgain(site, email);

  const page = await (await b.get('/account/security')).text();
  assert.match(page, /This device/);
  assert.equal((page.match(/action="\/account\/security\/revoke"/g) ?? []).length, 2, 'one End button per OTHER sign-in');
  assert.match(page, /Two-step verification/);
  assert.match(page, /Not available yet/, 'the unbuilt things say so');

  const sessionId = (await site.db.prepare('SELECT id FROM account_sessions WHERE account_id = ? ORDER BY created_at DESC').bind(id).first('id'));
  assert.equal((await b.post('/account/security/revoke', { sessionId })).headers.get('location'), '/account/security?done=revoked');
  assert.equal(await count(site, 'SELECT COUNT(*) AS n FROM account_sessions WHERE account_id = ?', id), 2);

  assert.equal((await b.post('/account/security/sign-out-others', {})).headers.get('location'), '/account/security?done=signed-out-others');
  assert.equal(await count(site, 'SELECT COUNT(*) AS n FROM account_sessions WHERE account_id = ?', id), 1);
  assert.equal((await b.get('/account')).status, 200, 'this device survives');
  assert.equal((await phone.get('/account')).status, 303);
});

test('this device cannot end itself through "revoke"', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  const mine = await site.db.prepare('SELECT id FROM account_sessions WHERE account_id = ?').bind(id).first('id');
  await b.post('/account/security/revoke', { sessionId: mine });
  assert.equal((await b.get('/account')).status, 200);
});

/* ── Deletion ────────────────────────────────────────────────────────────────────────────── */

const sha256 = (value) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

/** A ticket as Nova.Help stores it, filed by an account (or as a guest when accountId is null). */
async function fileTicket(site, { id, accountId, email, name = 'Ann', ip = '198.51.100.7' }) {
  await site.db
    .prepare(
      `INSERT INTO tickets (id, version, schema_version, created_at, updated_at, project, category, issue_type,
         subject, description, priority, status, requester_name, requester_email, requester_email_hash,
         account_id, source_channel, source_ip)
       VALUES (?, 1, 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 'atlas', 'bug', 'crash',
         'Atlas crashes on start', 'It crashes when I open it on Windows 11.', 'normal', 'open', ?, ?, ?, ?, 'web', ?)`,
    )
    .bind(id, name, email, sha256(email), accountId, ip)
    .run();
  const event = (seq, actorKind, actorName, body) =>
    site.db
      .prepare(
        `INSERT INTO ticket_events (ticket_id, seq, id, at, type, actor_kind, actor_name, visibility, body)
         VALUES (?, ?, ?, '2026-09-01T00:00:00Z', 'message', ?, ?, 'public', ?)`,
      )
      .bind(id, seq, `${id}-e${seq}`, actorKind, actorName, body)
      .run();
  await event(0, 'user', name, 'It crashes when I open it.');
  await event(1, 'staff', 'Sam (support)', 'Thanks, we are looking at it.');
  await event(2, 'system', null, 'Status changed.');
}

const deletionForm = (email = 'ann@example.com') => ({ confirmEmail: email, currentPassword: PASSWORD, understand: 'yes' });

test('deleting an account refuses without the password, the typed address, or the tick, and deletes nothing', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);

  assert.equal((await b.get('/account/delete')).status, 200);
  assert.match(await (await b.get('/account/delete')).text(), /This cannot be undone/);

  assert.equal((await b.post('/account/delete', { ...deletionForm(), currentPassword: 'wrong' })).status, 403);
  assert.equal((await b.post('/account/delete', { ...deletionForm('someone@else.com') })).status, 400);
  assert.equal((await b.post('/account/delete', { confirmEmail: 'ann@example.com', currentPassword: PASSWORD })).status, 400, 'no tick');

  assert.equal(await count(site, 'SELECT COUNT(*) AS n FROM accounts WHERE id = ?', id), 1);
  assert.equal((await b.get('/account')).status, 200, 'still signed in');
});

test('a deleted account is gone from every product, its cookie is dead, and its address is free', async (t) => {
  const site = await createSite(t);
  const { b, id, email } = await signUp(site);
  const phone = await signInAgain(site, email);
  await b.upload('/account/avatar', png());

  const done = await b.post('/account/delete', deletionForm());
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/account/deleted');
  assert.match(done.headers.get('set-cookie') ?? '', /nova_session=;.*Max-Age=0/, 'the cookie is cleared');

  for (const table of ['accounts', 'account_sessions', 'account_products', 'account_avatars']) {
    assert.equal(await count(site, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  }
  assert.equal((await phone.get('/account')).status, 303, 'another device is signed out');
  assert.equal(site.env.AVATARS.objects.size, 0, 'the picture is gone from R2');
  assert.match(await (await browser(site).get('/account/deleted')).text(), /has been deleted/);
  assert.match(site.mailer.sent.at(-1).subject, /was deleted/);

  const again = await browser(site).post('/account/new', { email, password: PASSWORD, passwordConfirm: PASSWORD });
  assert.equal(again.status, 303, 'the address can be registered again');
  assert.notEqual((await site.db.prepare('SELECT id FROM accounts WHERE email_normalized = ?').bind(email).first('id')), id, 'a new account');
});

test('deleting an account removes objects left by an interrupted upload too', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  await site.env.AVATARS.put(`avatars/${id}/${'a'.repeat(48)}`, png());
  await site.env.AVATARS.put('tickets/T-1/attachment', new Uint8Array([9]));
  await b.post('/account/delete', deletionForm());
  assert.equal(site.env.AVATARS.objects.size, 1, 'only the unrelated ticket attachment is left');
  assert.ok(site.env.AVATARS.objects.has('tickets/T-1/attachment'));
});

test('deleting anonymises the account\'s tickets, keeps the support history, and touches nobody else\'s', async (t) => {
  const site = await createSite(t);
  const ann = await signUp(site, 'ann@example.com');
  const bob = await signUp(site, 'bob@example.com', 'Bob');
  await fileTicket(site, { id: 'T-ANN-1', accountId: ann.id, email: 'ann@example.com' });
  await fileTicket(site, { id: 'T-ANN-2', accountId: ann.id, email: 'ann@example.com' });
  await fileTicket(site, { id: 'T-BOB-1', accountId: bob.id, email: 'bob@example.com', name: 'Bob' });
  // A guest ticket filed with Ann's address: never linked to her account, so never touched.
  await fileTicket(site, { id: 'T-GUEST', accountId: null, email: 'ann@example.com' });

  const before = await site.db.prepare('SELECT version FROM tickets WHERE id = ?').bind('T-ANN-1').first('version');
  const done = await ann.b.post('/account/delete', deletionForm());
  assert.equal(done.status, 303);

  const rows = (await site.db.prepare("SELECT * FROM tickets WHERE id LIKE 'T-ANN-%' ORDER BY id").all()).results;
  assert.equal(rows.length, 2, 'the tickets are KEPT');
  for (const row of rows) {
    assert.equal(row.account_id, null, 'no link to the deleted account');
    assert.equal(row.requester_name, null);
    assert.equal(row.source_ip, null);
    assert.ok(!row.requester_email.includes('ann'), 'no trace of the address');
    assert.match(row.requester_email, /^deleted-[0-9a-f]{24}@nova\.invalid$/);
    assert.match(row.requester_email_hash, /^[0-9a-f]{64}$/);
    assert.equal(row.version, before + 1, 'version bumped so a stale writer cannot restore the name');
    // The support history is untouched.
    assert.equal(row.subject, 'Atlas crashes on start');
    assert.equal(row.description, 'It crashes when I open it on Windows 11.');
    assert.equal(row.status, 'open');
    assert.equal(row.project, 'atlas');
  }
  assert.notEqual(rows[0].requester_email, rows[1].requester_email, 'a DIFFERENT random address per ticket');
  assert.notEqual(rows[0].requester_email_hash, rows[1].requester_email_hash);

  // The original address no longer finds them: not by hash lookup, not by ID-and-address.
  assert.equal(await count(site, "SELECT COUNT(*) AS n FROM tickets WHERE id LIKE 'T-ANN-%' AND requester_email_hash = ?", sha256('ann@example.com')), 0);

  const events = (await site.db.prepare("SELECT actor_kind, actor_name, body FROM ticket_events WHERE ticket_id = 'T-ANN-1' ORDER BY seq").all()).results;
  assert.deepEqual(events.map((e) => e.actor_name), ['Former user', 'Sam (support)', null], 'the requester\'s name goes; staff names stay');
  assert.deepEqual(events.map((e) => e.body), ['It crashes when I open it.', 'Thanks, we are looking at it.', 'Status changed.'], 'what was said stays');

  // Everybody else is exactly as they were.
  const bobTicket = await site.db.prepare("SELECT * FROM tickets WHERE id = 'T-BOB-1'").first();
  assert.equal(bobTicket.account_id, bob.id);
  assert.equal(bobTicket.requester_email, 'bob@example.com');
  assert.equal(bobTicket.requester_name, 'Bob');
  const guest = await site.db.prepare("SELECT * FROM tickets WHERE id = 'T-GUEST'").first();
  assert.equal(guest.requester_email, 'ann@example.com', 'a guest ticket is not linked to the account and is left alone');
  assert.equal(guest.requester_name, 'Ann');
  assert.equal(await count(site, "SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = 'T-BOB-1' AND actor_name = 'Bob'"), 1);
});

test('if the ticket cleanup fails, the account is NOT deleted (one transaction)', async (t) => {
  const site = await createSite(t);
  const { b, id } = await signUp(site);
  await fileTicket(site, { id: 'T-1', accountId: id, email: 'ann@example.com' });
  // Sabotage the second statement so the batch must fail as a whole.
  await site.db.exec('ALTER TABLE tickets RENAME COLUMN source_ip TO source_ip_renamed');

  await assert.rejects(() => b.post('/account/delete', deletionForm()));

  assert.equal(await count(site, 'SELECT COUNT(*) AS n FROM accounts WHERE id = ?', id), 1, 'the account survives');
  assert.equal((await site.db.prepare("SELECT actor_name FROM ticket_events WHERE ticket_id = 'T-1' AND seq = 0").first('actor_name')), 'Ann', 'and the earlier statement was rolled back');
  assert.equal((await b.get('/account')).status, 200, 'still signed in');
});

/* ── Rate limiting ───────────────────────────────────────────────────────────────────────── */

test('password-checking routes are rate-limited per account, so a session cannot be used to guess', async (t) => {
  const site = await createSite(t, { limiter: true });
  const { b } = await signUp(site);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await b.post('/account/email', { newEmail: 'x@example.com', currentPassword: `guess-${attempt}` });
    assert.equal(response.status, 403, `attempt ${attempt + 1}`);
  }
  const blocked = await b.post('/account/email', { newEmail: 'x@example.com', currentPassword: 'guess-11' });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));

  // The window is shared across the three sensitive routes, and the RIGHT password is blocked too.
  assert.equal((await b.post('/account/delete', deletionForm())).status, 429);
  assert.equal((await b.post('/account/password', { currentPassword: PASSWORD, password: NEW_PASSWORD, passwordConfirm: NEW_PASSWORD })).status, 429);
});
