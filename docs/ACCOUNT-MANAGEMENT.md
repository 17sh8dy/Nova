# Nova Account management

**Status (updated 2026-10-29): the account pages ARE deployed on `nova-780.pages.dev`** (profile, email, password,
security, delete), on the shared `nova-help` D1 database. Two-step verification was built, deployed, and then
**reverted the same day** (see below). Nothing in this file is a launch announcement; Nova has effectively no users.

> ## ⛔ PRODUCTION LAUNCH BLOCKER — password sign-in is not reliable on the Cloudflare Workers Free plan
>
> **Do not launch a Nova product that requires an account, and do not invite people to depend on Nova Accounts,
> until this is resolved and reliable authentication has been verified.**
>
> Password checks use scrypt at N=2^17 (128 MiB, about 240 ms of CPU). The Workers **Free** plan allows about 10 ms of
> CPU per request, so hashing a password is far over budget. Cloudflare does not kill every over-budget request,
> which is why sign-in has *seemed* to work, but it fails unpredictably (`Error 1101`, outcome `exceededCpu`).
>
> **Measured 2026-10-29 on Cloudflare's real edge** (`wrangler dev --remote`, nothing deployed), same sign-in code,
> isolated from every other part of the site:
>
> | Code | Sign-ins that succeeded |
> | --- | --- |
> | Accounts package before 2FA | 13 of 25 (about 50%) |
> | Accounts package with 2FA | 4 of 20 (20%) |
>
> - **This predates 2FA.** The old code failed about half the time. 2FA made it worse because it adds startup work.
>   A single successful sign-in in the logs (379 ms CPU, `ok`) was luck, not proof the limit is not enforced.
> - It affects **everything that checks a password**: sign-in, sign-up, change password/email, delete account,
>   and any future step that re-asks for the password. Nova.Help runs the same package, so it is exposed too (its own
>   sign-in was not captured in the logs, so treat that as unconfirmed rather than known-good).
> - **Do not weaken password security to fit the Free plan.** Lowering the scrypt cost to something that fits in
>   ~10 ms makes new hashes too weak to be a real password hash, and existing hashes carry their own cost and would
>   still fail. This is an infrastructure problem and gets an infrastructure fix.
> - **Not a problem today** only because nobody depends on it. That is the only reason it is acceptable to wait.
>
> See *Hosting options* and *When to upgrade* below.

## Where two-step verification stands

Built, tested (NovaHelp 744/745 with one unrelated flaky rate-limit test that passes alone; Nova 131/131), deployed,
found to push sign-in over the Free-plan CPU limit more often, and **reverted** on 2026-10-29. **The work is intact in git
history and is meant to be re-applied**, not rewritten:

| Repo | Feature commit | Revert commit |
| --- | --- | --- |
| Nova | `a4e6df7` | `7865ac0` |
| NovaHelp | `3adcc2a` | `e63a2c5` |

To bring it back: `git revert 7865ac0` in Nova and `git revert e63a2c5` in NovaHelp (a revert of the revert), then deploy
**NovaHelp first**, apply `0002_account_mfa.sql`, then the Nova site. Only do that **after** sign-in is reliable (Workers
Paid, or the Nova-owned option below), and verify in the live logs before telling anyone to enrol.

Notes on restoring (checked 2026-10-29):

- **Commit or stash local edits first.** `git revert` refuses to run over uncommitted changes to a file it touches, and the
  feature commit also edits this document. If this file is still uncommitted when you restore, commit it first, then expect
  a small conflict in this file and keep the *current* text of the sections above.
- The feature commits are complete, self-contained and on `origin/main` (Nova 15 files, NovaHelp 14 files, tests included).
  Each revert commit is an exact inverse: Nova `HEAD` was verified byte-identical to pre-2FA `1d91e03`, and NovaHelp `HEAD` to
  pre-2FA `a8c41a0`. Nothing authentication-related was lost or left half-reverted.
- Deployed state at that check: Nova Pages production = `7865ac0` (deployment `d9352999`); Nova.Help Worker = version
  `cfcc6450`, deployed from the reverted tree. The two-step URLs return 404 on both. The shared D1 database holds the empty
  `account_mfa` table (0 rows) and 1 account.

What is already in production from it: only the **empty `account_mfa` table** in the shared D1 database (additive,
harmless, nothing reads it). Nobody was ever enrolled.

What it does, in one paragraph, so the design is not lost: authenticator-app TOTP (RFC 6238) with a QR code drawn
server-side (no third-party QR service); secrets sealed with AES-256-GCM under a key derived from `NOVA_SECRET`,
recovery codes stored only as keyed hashes and each single-use (redeemed atomically); not enabled until a real code is
shown; `signIn` never returns success for an enrolled account (it returns a short-lived ticket), so older callers fail
closed; five wrong codes lock the second step for 15 minutes per account; a code cannot be replayed; turning it off or
replacing recovery codes needs the password **and** a code; a password-reset link and a Google sign-in both still require
the second step; enabling/disabling signs out every other device. Not yet verified: behaviour on real D1 under concurrent
requests (only the local SQLite stand-in was used), and the Google-callback route change has no automated test.

## Hosting options for Nova Accounts

Nova Accounts is Node-style code (`node:crypto`, scrypt) behind two small seams: a **store** (JSON files or D1) and a
**mailer**. That is what keeps it movable. Costs are approximate and for planning, not quotes.

### 1. Cloudflare Workers Free — development and limited testing

- **Good:** $0; already set up; fine for building, local-style testing and the static marketing pages.
- **Bad:** password hashing exceeds the CPU limit, so sign-in is unreliable (the launch blocker above); lower request
  and Durable Object/D1 quotas.
- **Security:** nothing wrong with the design; the platform just cannot run a strong password hash reliably.
- **Scale / maintenance:** nothing to maintain; not suitable as the public sign-in path.
- **Verdict:** keep using it for development. Not for public authentication.

### 2. Cloudflare Workers Paid — the simplest reliable fix

- **Cost:** $5/month base (usage beyond generous included amounts is billed; sign-in volume at Nova's size is far below it).
- **Good:** 30 s CPU per request (raisable), so scrypt at full strength fits with huge margin; **no code or security
  change**; same D1, R2, Durable Objects, Pages; global edge; no servers to run.
- **Bad:** recurring cost; deeper dependency on Cloudflare (D1, Durable Objects, Pages Functions).
- **Security:** unchanged; Cloudflare patches the platform. Secrets live in Cloudflare.
- **Scale / maintenance:** scales without effort; almost no maintenance.
- **Verdict:** the default plan when public authentication becomes necessary. Cheapest in time.

### 3. Nova-owned servers — host Nova Accounts on your own Linux machines

- **Cost:** hardware you already own plus power and a stable connection; a static IP or tunnel; possibly a small VPS for a
  public front. Cloudflare Tunnel (free) can expose a home server without opening ports.
- **Good:** no per-request CPU limit; full control; scrypt at any strength; data stays with you; no platform lock-in; the
  existing Node entry point (`npm start`, file store or SQLite/Postgres behind the store seam) already runs this way.
- **Bad:** **you are the on-call.** Uptime depends on your power, your ISP and your hardware; backups, OS and TLS
  updates, monitoring, DDoS exposure and abuse handling are yours. A residential outage means nobody can sign in. A
  password database on a machine at home needs real hardening (disk encryption, firewall, minimal exposed surface,
  tested restores).
- **Security:** can be excellent or poor depending on discipline; the database of password hashes is a high-value target.
- **Scale:** vertical; a single box handles far more than Nova needs, but there is no automatic redundancy.
- **Maintenance:** continuous (patching, backups, monitoring). Highest ongoing effort.
- **Verdict:** a sensible long-term option, and a good fit if you enjoy running servers. Not a free option once your time
  is counted.

### 4. Hybrid — Cloudflare in front, Nova-owned servers behind

- **Shape:** Cloudflare serves the static sites, caching, TLS and DDoS protection; only the heavy or sensitive pieces
  (password hashing, the accounts database, selected backends) run on your servers, reached over Cloudflare Tunnel or
  an authenticated API. For example: the Nova site stays on Pages; `/account/*` sign-in calls an accounts service you host.
- **Cost:** mostly Free-tier Cloudflare plus your servers; can avoid Workers Paid.
- **Good:** removes the CPU problem without paying per month; keeps Cloudflare's protection in front of your hardware;
  you can move one piece at a time; fails more gracefully (static pages stay up if the server is down).
- **Bad:** most moving parts; two places to secure and debug; a network hop between the edge and the service; sessions
  and cookies must work across both (already true: one `NOVA_SECRET`, one cookie domain plan); you still own the uptime of
  the hosted part.
- **Security:** keep the origin reachable only through the tunnel, and treat the service as internet-facing.
- **Scale / maintenance:** scales the stateless edge for free; the hosted service is on you.
- **Verdict:** the likely end state if you want to avoid recurring costs *and* keep a public front door.

### Comparison at a glance

| | Free | Paid | Own servers | Hybrid |
| --- | --- | --- | --- | --- |
| Reliable password sign-in | **No** | **Yes** | Yes | Yes |
| Recurring cost | $0 | ~$5/mo | power + connection | low |
| Effort to run | none | none | **high** | medium-high |
| Cloudflare lock-in | high | high | **none** | medium |
| Single point of failure | no | no | **yes (your site)** | partial |
| Code changes needed | — | none | small (new store/entry) | medium |

## Keeping Nova Accounts portable (a design note, not a task)

This is a **future consideration. Do not rewrite the authentication architecture for portability, and do not start a
migration.** The existing structure already helps; the aim is only to avoid making a later move harder:

- `packages/nova-accounts` takes its storage (`store`) and mail transport (`mailer`) as injected objects and may not import
  from the rest of the repo (a test enforces it). A new database means one new store file with the same methods, not a
  rewrite. Keep it that way.
- Keep Cloudflare-specific things at the edges: D1, R2 (`AVATARS`), the Durable Object rate limiter and Pages Functions
  glue live in `functions/` and `d1Store.mjs`, not in the account rules. Do not push account *decisions* into Cloudflare
  features.
- Keep account state in the database, not in platform-specific features (no logic that only works because of a Worker
  KV/Queue quirk).
- Keep `NOVA_SECRET` the single root for derived keys, so moving hosts means moving one secret.
- New dependencies: prefer the platform-neutral option (`node:crypto`, plain SQL) over a Cloudflare-only API when the cost
  is equal.

## When to upgrade (or move)

Revisit hosting **when a real need appears, not at an arbitrary user count**. Any one of these is the trigger:

1. A Nova product **requires** an account (today none does; accounts must stay optional per the ecosystem rules).
2. We start **inviting real users to register** or sign in.
3. **Reliable public authentication** becomes necessary for any reason.
4. Infrastructure needs **outgrow what Free can safely support** (CPU, D1/Durable Object limits, request volume).

**Before any of those happen:** choose Paid or the Nova-owned/hybrid route, re-apply two-step verification, and verify in
the live logs that password sign-in succeeds reliably (not "worked once"). Until then, accounts stay a developer feature.


## What lives where

> Apps handle identity display and navigation. Nova handles account management.

| Action | In every app | On Nova |
| --- | --- | --- |
| View who you are | yes | yes |
| Sign out | yes (a local action) | yes |
| Edit profile / name | button → Nova | `/account/profile` |
| Profile picture | button → Nova | `/account/profile` |
| Change email | button → Nova | `/account/email` |
| Change password | button → Nova | `/account/password` |
| Security (sign-ins, sign out elsewhere) | button → Nova | `/account/security` |
| Delete account | button → Nova | `/account/delete` |

Atlas has **Edit Profile** and **Account Settings** buttons that open `https://nova-780.pages.dev/`.
Once these pages are deployed, point them at `/account` (one constant in Atlas:
`NOVA_ACCOUNT_URL`, `apps/web/src/account/novaAccount.ts`).

## Which account package is authoritative

There are two copies of `@nova/accounts` and they are **byte-identical by design**:

- `NovaHelp/packages/nova-accounts` — **the source of truth.** Nova.Help runs it, and its git history
  is where the package was built.
- `Nova/packages/nova-accounts` — a **vendored copy**, added in the commit "Vendor @nova/accounts so
  Cloudflare can build the site" because a Cloudflare Pages build cannot reach a sibling repo.

Both talk to the **same D1 database** (`nova-help`, id `60b37c5d-…`) and must share the same
`NOVA_SECRET`. **Every change to the package is made in NovaHelp and then copied to Nova**
(`cp -r NovaHelp/packages/nova-accounts/. Nova/packages/nova-accounts/`). They were left separate,
not merged: consolidating them would change how Nova is built and deployed for no functional gain.

## What was added

### Package (`@nova/accounts`) — additive

- `updateProfile`, `changePassword`, `changeEmail`, `listSessions`, `signOutOthers`, `revokeSession`,
  `deleteAccount`, and avatar reference methods on the service.
- `avatars.mjs`: picture validation. The type is decided **from the file's bytes** (PNG, JPEG, WebP);
  filename and declared type are never consulted; SVG/HTML/GIF are refused; 256 KB and 2048 px limits;
  object keys are generated (`avatars/<accountId>/<48 hex>`) and never contain anything from a request.
- Both stores (file and D1) gained `changeEmail`, `deleteAccount`, and avatar reference methods.
- Two new mail messages: the **old** address is told when the email changes; the address is told when the
  account is deleted.

### Nova site (`functions/`)

- `_lib/manage.mjs`: the pages and routes. `_lib/avatars.mjs`: R2. `_lib/tickets.mjs`: ticket anonymisation.
- `account/[[path]].mjs`: one hook (`handleManage`) and an updated overview page.
- `assets/account-avatar.js`: shrinks a picture to 256 px in the browser before upload (presentation only;
  the server validates the bytes regardless).

### Rules every management route follows

1. Identity is the session cookie and nothing else.
2. State changes are POST-only behind `SameSite=Lax` (the site's existing CSRF stance).
3. **Email change, password change and deletion re-ask for the current password.** A stolen cookie alone
   cannot take or destroy the account.
4. Those three are rate-limited per account (10 per 15 minutes, shared), because a session is otherwise a
   password-guessing oracle.
5. Passwords are never echoed back into a page.
6. Changing the password signs out every other session, including apps signed in by device grant.

## Profile pictures and R2

**No new bucket.** The existing `nova-help-attachments` bucket is bound to the Nova site as `AVATARS`.
Pictures use the `avatars/` prefix, ticket attachments use `tickets/`; neither reads or writes the other.
Every object deleted is first checked to be a picture key **for that account**, so a forged database row
cannot delete a ticket attachment (tested).

The database stores only a reference (`account_avatars`: key, content type, size, date). Served with the
content type we determined, `nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox`.
A person can only fetch **their own** picture; there is no route that takes an account id.

When the R2 binding is missing the profile page says pictures are unavailable and uploads return 503.

## Account deletion and Nova.Help tickets

Decision: **anonymise, do not delete.** Implemented in `functions/_lib/tickets.mjs`, run **in the same
transaction** as the account delete (`D1 batch`) — either the tickets are anonymised and the account is
gone, or nothing happened (tested by sabotaging the second statement).

`tickets` has no foreign key to accounts; the link is the plain `tickets.account_id` column. For tickets
carrying the deleted account's id:

| Column | Becomes |
| --- | --- |
| `tickets.account_id` | `NULL` (what a guest ticket already is — no Nova.Help code path changes) |
| `tickets.requester_name` | `NULL` |
| `tickets.requester_email` | random `deleted-<hex>@nova.invalid`, **different per ticket** |
| `tickets.requester_email_hash` | random 64 hex, **different per ticket** |
| `tickets.source_ip` | `NULL` |
| `tickets.version` | `+1` (a stale writer fails instead of restoring the name) |
| `ticket_events.actor_name` | `'Former user'` for the requester's own events (`user`/`assistant` actors) |

Why per-ticket random values rather than one placeholder: Nova.Help opens a ticket by *ID + the address it
was filed with*, comparing the address as text, and lists "my tickets" by hashing an address. A shared
placeholder would let anyone holding a ticket ID open every anonymised ticket. Random values leave no
address to present.

**Kept:** subject, description, event bodies, status, history, tags, and attachments (rows and R2 objects).
**Not scrubbed:** free text. If someone typed their own name or phone number into a ticket, nothing here
finds it. **Untouched:** guest tickets (never linked to an account) and every other account's tickets.

## Database migration

**One additive migration**, `packages/nova-accounts/migrations/0001_account_avatars.sql`: a new table
`account_avatars`. It does not alter, rename, drop or rewrite any existing table or row.

- Who uses the affected tables: `accounts` is shared by Nova.Help and Nova, and is **not modified**. The
  new table is used only by the Nova site. Nova.Help never reads it.
- Safe to run against the live database while Nova.Help is running; re-running is a no-op.
- **Deploy order does not matter for safety:** if the new code is deployed before the migration, reading a
  picture returns "none" (the store treats a missing table as no picture) and account deletion still works;
  only *uploading* a picture fails, loudly, until the migration runs. (Tested.)
- Roll back: `DROP TABLE account_avatars;` — nothing else depends on it.

```
npx wrangler d1 execute nova-help --remote --file packages/nova-accounts/migrations/0001_account_avatars.sql
```

## Known gaps (stated, not hidden)

- **No email verification.** A changed address starts unverified. Nothing gates on verification today, and
  ticket access follows the account id, never a matching address — so this is not an access hole — but
  "verified" means nothing yet.
- **Google sign-in and two-step verification** are shown on the Security page as "Not available yet".
- An account with **no password** (a future Google-only account) cannot change its address or delete
  itself; it is told to choose a password through the reset flow first.
- The **mail transport** is still the placeholder. Notifications (old address on email change, password
  changed, account deleted) are sent through the same mailer as password reset, so they go nowhere until a
  transport exists.
- The rate limiter is a Durable Object owned by Nova.Help's Worker; it is enforced only where that binding
  exists. Tested with a fake.
- A **deleted account's product tokens** die with its sessions (they are rows in `account_sessions`), but an
  app that cached a token learns only on its next request.

## Deployment checklist (do NOT do until asked)

1. Apply `0001_account_avatars.sql` to the shared `nova-help` database (or deploy first; see order above).
2. Deploy the Nova site **with Functions**, bindings: `DB` (nova-help), `AVATARS` (`nova-help-attachments`),
   `RATE_LIMITER` (Nova.Help's DO), secret `NOVA_SECRET` = Nova.Help's `NOVA_HELP_SECRET`.
3. Copy the package to NovaHelp's deployment only if Nova.Help should also carry the new package code (it is
   not required: Nova.Help does not call the new methods).
4. Smoke test: sign up, upload a picture, change name/email/password, sign out elsewhere, delete a **test**
   account and check its test ticket was anonymised.
5. Point Atlas's `NOVA_ACCOUNT_URL` at `/account`.
