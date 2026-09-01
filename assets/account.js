/* ─────────────────────────────────────────────────────────────
   Nova — the account chip on static pages

   The static pages are files. Cloudflare serves the same bytes to
   everybody, so the markup cannot know who is asking — it ships
   saying "Sign in", which is right for a visitor and right for
   anybody with JavaScript off.

   This asks /account/status once and upgrades the chip to the
   person's name when there is a session. It is presentation only:
   nothing here decides anything, and a forged answer buys nothing
   because every page that matters re-checks the session cookie on
   the server before rendering a single private byte.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  var chip = document.querySelector("[data-account-chip]");
  if (!chip || !window.fetch) return;

  fetch("/account/status", {
    /* The cookie is the whole point of the request. `same-origin` is the default in modern
       browsers but is stated because this breaking silently would look like "signed in on
       one page, signed out on the next". */
    credentials: "same-origin",
    headers: { accept: "application/json" },
    cache: "no-store"
  })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (status) {
      if (!status || !status.signedIn) return;
      chip.textContent = status.name;
      chip.setAttribute("href", "/account");
      chip.setAttribute("title", "Your Nova Account");
      chip.classList.remove("account-chip--guest");
    })
    .catch(function () {
      /* Offline, blocked, or the Function is not deployed. The chip keeps saying "Sign in",
         which still leads somewhere correct. */
    });
})();
