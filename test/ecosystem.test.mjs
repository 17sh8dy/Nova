/**
 * The Nova site's links out — to support, to the community, and to itself.
 *
 * These are static pages, so this reads them off disk rather than standing a Worker up. What
 * it is guarding is the class of mistake that only shows up on the page nobody re-checks: a
 * footer that was updated on the homepage and not on the 404, or a claim in a footer note that
 * used to be true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DISCORD = 'https://discord.gg/XBhER9Z6EB';
const SUPPORT = 'https://nova-help.shadylabs.workers.dev/';

async function pages() {
  const files = (await readdir(root)).filter((f) => f.endsWith('.html'));
  return Promise.all(
    files.map(async (file) => ({ file, html: await readFile(path.join(root, file), 'utf8') })),
  );
}

test('every page reaches support and the community from its footer', async () => {
  const all = await pages();
  assert.ok(all.length >= 5, 'there are pages to check');

  for (const { file, html } of all) {
    assert.ok(html.includes(SUPPORT), `${file} has no link to Nova.Help`);
    assert.ok(html.includes(DISCORD), `${file} has no Discord link`);
  }
});

test('the Discord invite is the real one, everywhere it appears', async () => {
  for (const { file, html } of await pages()) {
    /* The YouTube redirect form of this invite has been used elsewhere before. A short link
       that resolves somewhere else is exactly the kind of thing nobody re-checks, so the
       invite is pinned rather than merely present. */
    assert.equal(/discord\.gg\/[A-Za-z0-9]+/.exec(html)?.[0], 'discord.gg/XBhER9Z6EB', file);
    assert.equal(html.includes('youtube.com'), false, `${file} routes Discord through YouTube`);
  }
});

test('an outbound link does not hand the opener to the page it opens', async () => {
  for (const { file, html } of await pages()) {
    const discordTag = /<a href="https:\/\/discord\.gg\/[^"]+"[^>]*>/.exec(html)?.[0] ?? '';
    assert.match(discordTag, /rel="noopener"/, `${file}`);
  }
});

test('the footer note no longer claims nothing has been renamed', async () => {
  /* It said "nothing has been renamed, rebranded or redesigned yet" long after Open Engine
     became Nova Engine. A footer that is quietly wrong about the one rename that HAS happened
     is worse than no footer note, because it is the sentence a reader would use to decide
     which names to trust. */
  for (const { file, html } of await pages()) {
    if (!html.includes('footer-note')) continue;
    assert.equal(
      html.includes('nothing has been renamed, rebranded or redesigned yet'),
      false,
      `${file} still carries the stale claim`,
    );
    assert.match(html, /Open Engine is now Nova Engine/, `${file} should say what did change`);
  }
});

test('the ecosystem page points at help that exists rather than sites that do not', async () => {
  const html = await readFile(path.join(root, 'ecosystem.html'), 'utf8');

  assert.match(html, /nova-help\.shadylabs\.workers\.dev/, 'Nova.Help covers every product on this page');
  assert.match(html, /\/account/, 'and one account works across them');
  /* Every "Learn more" on this page is deliberately inert until the product sites exist. This
     pins that: a placeholder href is how a dead link gets shipped. */
  assert.equal(/href="#"/.test(html), false, 'no placeholder links');
});

test('the homepage numbers add up to the statuses on the ecosystem page', async () => {
  const eco = await readFile(path.join(root, 'ecosystem.html'), 'utf8');
  const home = await readFile(path.join(root, 'index.html'), 'utf8');
  const count = (cls) => (eco.match(new RegExp(`class="status status-${cls}"`, 'g')) ?? []).length;

  const inBuild = count('alpha') + count('dev') + count('production');
  const onTheWay = count('planned');
  const fact = (label) => Number(new RegExp(`<b>([0-9]+)</b><span>${label}`).exec(home)?.[1]);

  assert.equal(fact('In build today'), inBuild, 'in build');
  assert.equal(fact('On the way'), onTheWay, 'on the way');
  assert.equal(fact('Products &amp; platforms'), inBuild + onTheWay, 'total');
});

test('the support link resolves to a real address, not the unregistered nova.help', async () => {
  for (const { file, html } of await pages()) {
    assert.equal(/https?:\/\/nova\.help/.test(html), false, `${file} links to nova.help, which has no DNS`);
  }
});

test('the site uses American spelling', async () => {
  for (const { file, html } of await pages()) {
    assert.equal(/\b(centre|colour|customis\w+|licence|organis\w+|authorised)\b/i.test(html), false, file);
  }
});
