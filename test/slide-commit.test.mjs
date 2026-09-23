/**
 * The Slide Commit demo -- a standalone prototype (Nova has no subscription/billing system;
 * see demo/slide-commit.html for the full disclaimer). Two different things are worth proving
 * here:
 *
 *   - `createMockSubscription`, the mocked "backend" call, genuinely resolves and genuinely
 *     rejects depending on how it is asked to behave, with no DOM involved -- it is exported
 *     from assets/slide-commit.js specifically so it can be driven directly from Node, the
 *     same way the rest of this repo tests behaviour rather than trusting a comment.
 *   - the demo page itself says plainly, in its own text, that it is a demo, is reachable only
 *     by direct URL, and is not linked from the site's real navigation -- because a prototype
 *     that quietly looks like a real purchase flow is exactly the kind of mistake this task
 *     was written to avoid.
 *
 * The drag gesture and the CSS states it drives (is-dragging / is-pending / is-success /
 * is-error) are DOM interaction and are not exercised here -- this repo's test runner has no
 * browser or DOM behind it (see the other test files: they all drive a router or read files
 * off disk, never a page). That part was checked by reading the code, not by clicking it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMockSubscription } from '../assets/slide-commit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── The mocked backend call ─────────────────────────────────────────────────────────────── */

test('forcing success always resolves, and never touches a real backend', async () => {
  const result = await createMockSubscription({ force: 'success', minDelay: 1, maxDelay: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.mock, true, 'the result says plainly that it is mocked');
});

test('forcing an error always rejects', async () => {
  await assert.rejects(
    () => createMockSubscription({ force: 'error', minDelay: 1, maxDelay: 2 }),
    /declined/,
  );
});

test('the call is genuinely asynchronous -- it does not settle before its own delay', async () => {
  const startedAt = Date.now();
  await createMockSubscription({ force: 'success', minDelay: 30, maxDelay: 40 });
  assert.ok(Date.now() - startedAt >= 29, 'resolved no earlier than its configured minimum delay');
});

test('left to chance, both outcomes are genuinely reachable', async () => {
  const outcomes = await Promise.all(
    Array.from({ length: 60 }, () =>
      createMockSubscription({ minDelay: 1, maxDelay: 3, successRate: 0.5 }).then(
        () => 'success',
        () => 'error',
      ),
    ),
  );
  assert.ok(outcomes.includes('success'), 'random mode produced at least one success in 60 tries');
  assert.ok(outcomes.includes('error'), 'random mode produced at least one failure in 60 tries');
});

test('a forced outcome is deterministic across repeats, unlike the random path', async () => {
  for (let i = 0; i < 5; i += 1) {
    const result = await createMockSubscription({ force: 'success', minDelay: 1, maxDelay: 2 });
    assert.equal(result.ok, true);
  }
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(() => createMockSubscription({ force: 'error', minDelay: 1, maxDelay: 2 }));
  }
});

/* ── The demo page itself ────────────────────────────────────────────────────────────────── */

const page = async () => readFile(path.join(root, 'demo/slide-commit.html'), 'utf8');

test('the demo page says plainly, in its own text, that it is a demo and nothing is charged', async () => {
  const html = await page();
  const flat = html.replace(/\s+/g, ' ');
  assert.match(flat, /no subscription or billing system yet/i);
  assert.match(flat, /never charges anything/i);
  assert.match(flat, /not linked from the site's navigation/i);
});

test('the demo page is not indexed and not part of the primary site chrome', async () => {
  const html = await page();
  assert.match(html, /noindex/, 'search engines are told to skip it');
  assert.doesNotMatch(html, /masthead-nav[^>]*>[\s\S]*?ecosystem\.html/i, 'no ecosystem link, unlike a real page');
});

test('the demo page wires up the slide-commit component', async () => {
  const html = await page();
  assert.match(html, /data-slide-commit/);
  assert.match(html, /data-slide-track/);
  assert.match(html, /data-slide-handle/);
  assert.match(html, /assets\/slide-commit\.js/);
  assert.match(html, /assets\/slide-commit\.css/);
  assert.match(html, /aria-live="polite"/);
});

test('nothing in the primary site pages links to the demo', async () => {
  const files = (await readdir(root)).filter((f) => f.endsWith('.html'));
  assert.ok(files.length >= 5, 'there are primary pages to check');
  for (const file of files) {
    const html = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(html, /slide-commit/i, `${file} should not reference the demo`);
  }
});
