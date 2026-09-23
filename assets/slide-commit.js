/* ─────────────────────────────────────────────────────────────
   Nova — the Slide Commit component (DEMO ONLY)

   Nova has no subscription or billing system (checked: zero hits
   for subscription/billing/checkout/payment/stripe anywhere in this
   repo). This file is a standalone, self-contained PROTOTYPE of the
   interaction React Bits calls "Slide to confirm" -- a handle you
   drag to the end of a track, which plants and spins while an async
   call is in flight, then either unfurls into a done pill or springs
   back home with a squash and a shake.

   It is wired into exactly one place: demo/slide-commit.html, a page
   reachable only by direct URL and linked from nowhere in the site's
   navigation. It is NOT part of any real purchase flow -- there
   isn't one -- and `createMockSubscription` below never claims a
   real charge or a real subscription. It is a stand-in with the
   SHAPE a real integration would need (an async call that resolves
   or rejects, on its own time), so every state a real integration
   would have to handle is genuinely reachable here, not merely
   drawn.

   `createMockSubscription` has no DOM dependency, on purpose: it is
   exported so test/slide-commit.test.mjs can drive it directly from
   Node, the same way this repo's other tests read behaviour rather
   than trust a comment. Everything below that line touches the DOM
   and only runs in a browser.
   ───────────────────────────────────────────────────────────── */

/**
 * Stands in for the eventual real subscription/payment call.
 *
 * TODO: replace with the real subscription/payment call once Nova has a billing system.
 *
 * `force` ("success" | "error") makes the outcome deterministic for a demo walkthrough or a
 * test; leaving it unset picks randomly (weighted by `successRate`) so the random path is
 * exercised too, exactly like a real payment provider that can genuinely go either way.
 */
export function createMockSubscription(options) {
  var opts = options || {};
  var minDelay = typeof opts.minDelay === 'number' ? opts.minDelay : 700;
  var maxDelay = typeof opts.maxDelay === 'number' ? opts.maxDelay : 1500;
  var successRate = typeof opts.successRate === 'number' ? opts.successRate : 0.6;

  return new Promise(function (resolve, reject) {
    var delay = minDelay + Math.random() * Math.max(0, maxDelay - minDelay);
    setTimeout(function () {
      var succeed = opts.force === 'success' ? true : opts.force === 'error' ? false : Math.random() < successRate;
      if (succeed) resolve({ ok: true, plan: 'demo', mock: true });
      else reject(new Error('mock-subscription-declined'));
    }, delay);
  });
}

/* ── DOM wiring -- browser only ─────────────────────────────────────────────────────────── */

if (typeof document !== 'undefined') {
  (function () {
    'use strict';

    var COMPLETE_THRESHOLD = 0.92; // fraction of the track the handle must cross to commit
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-slide-commit]'));
    if (!roots.length) return;

    roots.forEach(function (root) {
      var track = root.querySelector('[data-slide-track]');
      var handle = root.querySelector('[data-slide-handle]');
      var label = root.querySelector('[data-slide-handle-label]');
      var describedBy = handle ? handle.getAttribute('aria-describedby') : null;
      var statusEl = describedBy ? document.getElementById(describedBy) : null;
      var lineEl = root.querySelector('[data-slide-line]');
      if (!track || !handle) return;

      var state = 'idle'; // idle | dragging | pending | success | error
      var pointerId = null;
      var maxX = 0;

      function announce(text) {
        if (statusEl) statusEl.textContent = text;
        if (lineEl) lineEl.textContent = text;
      }

      function setX(px) {
        root.style.setProperty('--slide-x', px + 'px');
      }

      function outcome() {
        // The page's own controls set this so every state is genuinely demonstrable, not
        // only the ones chance happens to land on during a walkthrough.
        return root.getAttribute('data-force') || 'random';
      }

      function onPointerDown(ev) {
        if (state !== 'idle') return;
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        var trackRect = track.getBoundingClientRect();
        var handleRect = handle.getBoundingClientRect();
        maxX = Math.max(0, trackRect.width - handleRect.width - 6);
        pointerId = ev.pointerId;
        state = 'dragging';
        root.classList.add('is-dragging');
        if (handle.setPointerCapture) { try { handle.setPointerCapture(pointerId); } catch (e) { /* ignore */ } }
        ev.currentTarget.dataset.startClientX = String(ev.clientX);
        announce('Sliding…');
        ev.preventDefault();
      }

      function onPointerMove(ev) {
        if (state !== 'dragging' || ev.pointerId !== pointerId) return;
        var startX = Number(handle.dataset.startClientX || ev.clientX);
        var dx = ev.clientX - startX;
        var clamped = Math.max(0, Math.min(maxX, dx));
        setX(clamped);
      }

      function currentX() {
        var raw = getComputedStyle(root).getPropertyValue('--slide-x') || '0px';
        return parseFloat(raw) || 0;
      }

      function onPointerUp(ev) {
        if (state !== 'dragging' || ev.pointerId !== pointerId) return;
        root.classList.remove('is-dragging');
        var reached = maxX > 0 && currentX() >= maxX * COMPLETE_THRESHOLD;
        if (reached) {
          setX(maxX);
          commit();
        } else {
          setX(0);
          state = 'idle';
          announce('Released. Slide all the way to confirm.');
        }
      }

      function onPointerCancel(ev) {
        if (state !== 'dragging' || ev.pointerId !== pointerId) return;
        root.classList.remove('is-dragging');
        setX(0);
        state = 'idle';
      }

      function commit() {
        state = 'pending';
        root.classList.remove('is-success', 'is-error');
        root.classList.add('is-pending');
        handle.disabled = true;
        announce('Confirming (demo only -- nothing is charged)…');

        createMockSubscription({ force: outcome() === 'random' ? undefined : outcome() })
          .then(function () {
            state = 'success';
            root.classList.remove('is-pending');
            root.classList.add('is-success');
            if (label) label.textContent = 'Subscribed (demo)';
            handle.setAttribute('aria-disabled', 'true');
            announce('Subscribed. This is a demo -- nothing was charged.');
          })
          .catch(function () {
            state = 'error';
            root.classList.remove('is-pending');
            root.classList.add('is-error');
            root.style.setProperty('--slide-x-from', maxX + 'px');
            announce('That did not go through. Slide again to retry.');
            var settle = function () {
              root.classList.remove('is-error');
              handle.removeEventListener('animationend', settle);
              setX(0);
              handle.disabled = false;
              state = 'idle';
            };
            if (reduced.matches) {
              settle();
            } else {
              handle.addEventListener('animationend', settle);
            }
          });
      }

      /** Puts a finished (success or error-settling) widget back to idle, for re-demoing. */
      function reset() {
        state = 'idle';
        root.classList.remove('is-dragging', 'is-pending', 'is-success', 'is-error');
        setX(0);
        handle.disabled = false;
        handle.removeAttribute('aria-disabled');
        if (label) label.textContent = '';
        announce('');
      }

      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerCancel);

      // Keyboard equivalent: a real drag has no accessible keyboard analogue worth imitating
      // one pixel at a time, so Enter/Space on the focused handle stands in for "reached the
      // end of the track" -- the same commit() path a completed drag takes, not a shortcut
      // around it.
      handle.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
        ev.preventDefault();
        if (ev.repeat || state !== 'idle') return;
        var trackRect = track.getBoundingClientRect();
        var handleRect = handle.getBoundingClientRect();
        maxX = Math.max(0, trackRect.width - handleRect.width - 6);
        setX(maxX);
        commit();
      });

      root.novaSlideCommit = { reset: reset, state: function () { return state; } };
    });
  })();
}
