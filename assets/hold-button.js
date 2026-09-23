/* ─────────────────────────────────────────────────────────────
   Nova — hold-to-confirm buttons

   A deliberate-action gate on the ONE most destructive form on the
   site: permanent account deletion. This is a UI layer only, and it
   sits IN FRONT of the password + typed-address + tick that
   functions/_lib/manage.mjs already requires and that the server
   re-checks on every POST regardless of what this file does. It
   adds one more thing a person has to mean to do; it does not
   replace any of those checks and it cannot -- there is nothing in
   this file that talks to the server before a real, hold-completed
   form submission.

   If this script fails to load, the button is a plain
   <button type="submit">: a normal click submits it, exactly like
   before this file existed, and the server-side checks are still
   the whole gate. Progressive enhancement, not a second path.

   Works the same for a mouse, a touch, and a keyboard: Pointer
   Events cover the first two, and Enter/Space held down (not
   pressed once) drive the same start / cancel / complete states.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  /* The one place the hold duration lives. React Bits' own hold-button pattern runs
     roughly 1.5-2s; 1800ms sits in the middle of that. Nothing else -- not the CSS, not
     manage.mjs's markup -- hardcodes a number of milliseconds. The fill's CSS transition
     duration is set from this constant, below, once per button. */
  var HOLD_MS = 1800;
  /** How long the label takes to blur out and back in with its new text. */
  var SWAP_MS = 260;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var HELD_KEYS = { "Enter": true, " ": true, "Spacebar": true };

  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-hold-button]"));
  if (!buttons.length) return;

  buttons.forEach(function (button) {
    var form = button.form;
    var label = button.querySelector("[data-hold-label]");
    var describedBy = button.getAttribute("aria-describedby");
    var statusEl = describedBy ? document.getElementById(describedBy) : null;
    var idleText = label ? label.textContent : "";
    var armedText = button.getAttribute("data-hold-armed-label") || idleText;

    var holding = false;
    var completed = false;
    var holdTimer = null;
    var swapTimer = null;

    button.style.setProperty("--hold-ms", HOLD_MS + "ms");

    function announce(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function start() {
      if (completed || button.disabled || holding) return;
      holding = true;
      button.classList.add("is-holding");
      announce("Holding — keep going to permanently delete your account.");
      holdTimer = window.setTimeout(complete, HOLD_MS);
    }

    function cancel() {
      if (!holding) return;
      holding = false;
      window.clearTimeout(holdTimer);
      button.classList.remove("is-holding");
      if (!completed) announce("Released. Hold again to permanently delete.");
    }

    function complete() {
      if (completed) return;
      holding = false;
      button.classList.remove("is-holding");
      window.clearTimeout(holdTimer);

      /* The hold finished, but this is still only a UI gate in front of the real one. If
         the password, the typed address or the tick above are not filled in, this must do
         exactly what a click on the old plain button always did: show the browser's own
         validation and go no further. It must never let a completed hold force a submit
         past fields the form itself requires. */
      if (form && typeof form.reportValidity === "function" && !form.reportValidity()) {
        announce("Fill in the password and the typed address first, then hold again.");
        return;
      }

      completed = true;
      button.classList.add("is-swapping");
      announce("Deleting your account…");

      swapTimer = window.setTimeout(function () {
        if (label) label.textContent = armedText;
        button.classList.remove("is-swapping");
        /* Disabled only now, after the real submission is already on its way out --
           disabling a `type="submit"` button earlier would make it inert without
           stopping anything, since requestSubmit() below does not depend on it. */
        button.disabled = true;
        if (form) {
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
        }
      }, reduced.matches ? 0 : SWAP_MS);
    }

    button.addEventListener("pointerdown", function (ev) {
      if (typeof ev.button === "number" && ev.button !== 0) return;
      start();
    });
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("blur", cancel);

    button.addEventListener("keydown", function (ev) {
      if (!HELD_KEYS[ev.key]) return;
      ev.preventDefault(); // stop Enter/Space's own click-on-press, and Space's page scroll
      if (ev.repeat) return; // a held key repeats keydown; the timer is already running
      start();
    });
    button.addEventListener("keyup", function (ev) {
      if (!HELD_KEYS[ev.key]) return;
      ev.preventDefault();
      cancel();
    });

    /* A `click` is what a quick tap, a stray mouse click, or a synthetic assistive-tech
       activation sends. It must never submit by itself -- only complete(), at the end of a
       genuine hold, does that. */
    button.addEventListener("click", function (ev) { ev.preventDefault(); });
  });
})();
