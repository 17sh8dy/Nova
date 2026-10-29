# Nova Account management

**Status: built and tested locally. NOT DEPLOYED.** The live site (`nova-780.pages.dev`) is still the
static build with no Functions, and the shared production database has not been touched. Deploying
is a separate, deliberate step; the checklist is at the bottom.

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
