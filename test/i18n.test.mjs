/**
 * The language system's wiring on the Nova site.
 *
 * The runtime, the selector styles and the catalogs are produced by ../NovaI18n and copied in
 * (this site deploys on its own, so they have to live here). What is guarded is the class of
 * mistake that only shows up on the page nobody re-checks: a new page that forgot the script tags,
 * a catalog that stopped parsing, or a translation that broke a product name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['es', 'fr', 'de', 'pt'];

const pages = async () =>
  Promise.all((await readdir(root)).filter((f) => f.endsWith('.html')).map(async (file) => ({ file, html: await readFile(path.join(root, file), 'utf8') })));

test('every page loads the language runtime, its styles, and has a place for the selector', async () => {
  for (const { file, html } of await pages()) {
    assert.match(html, /assets\/nova-i18n-boot\.js/, `${file}: pre-paint boot script`);
    assert.match(html, /assets\/nova-i18n\.css/, `${file}: selector styles`);
    assert.match(html, /assets\/nova-i18n\.js" data-base="\/i18n\/"/, `${file}: runtime`);
    assert.match(html, /data-nova-lang-slot/, `${file}: selector slot in the masthead`);
  }
});

test('the account pages, rendered by a Function, load it too', async () => {
  const shell = await readFile(path.join(root, 'functions/_lib/shell.mjs'), 'utf8');
  assert.match(shell, /nova-i18n-boot\.js/);
  assert.match(shell, /nova-i18n\.js" data-base="\/i18n\/"/);
  assert.match(shell, /data-nova-lang-slot/);
});

test('every catalog parses, is non-empty, and keeps the product names intact', async () => {
  for (const lang of LANGS) {
    const { strings } = JSON.parse(await readFile(path.join(root, 'i18n', `${lang}.json`), 'utf8'));
    const entries = Object.entries(strings);
    assert.ok(entries.length > 100, `${lang} has translations`);
    for (const [en, tr] of entries) {
      assert.ok(tr && tr.trim(), `${lang}: empty translation for "${en.slice(0, 40)}"`);
      for (const name of ['NovaCut', 'Nova.Help', 'Replay.GG', 'Atlas']) {
        const count = (s) => s.split(name).length - 1;
        assert.equal(count(tr), count(en), `${lang}: "${name}" changed in "${en.slice(0, 50)}"`);
      }
      const tags = (s) => (s.match(/<\/?\d+\/?>/g) || []).sort().join('');
      assert.equal(tags(tr), tags(en), `${lang}: markup placeholders differ in "${en.slice(0, 50)}"`);
    }
  }
});

test('the homepage and ecosystem pages are fully translated in every language', async () => {
  const src = JSON.parse(await readFile(path.join(root, 'i18n', 'source.json'), 'utf8'));
  for (const lang of LANGS) {
    const { strings } = JSON.parse(await readFile(path.join(root, 'i18n', `${lang}.json`), 'utf8'));
    for (const [key, where] of Object.entries(src.where)) {
      if (!where.some((p) => p === '/index.html' || p === '/ecosystem.html' || p === '/404.html')) continue;
      assert.ok(strings[key], `${lang}: missing translation on ${where[0]}: "${key.slice(0, 60)}"`);
    }
  }
});
