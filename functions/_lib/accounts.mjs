/**
 * Nova Accounts, as the Nova site sees it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE ARCHITECTURE, IN ONE PARAGRAPH. There is ONE Nova Account system. It lives in the
 * `@nova/accounts` package, it is the same code Nova.Help has been running and testing, and it
 * is bound here to the SAME D1 database. The Nova site is not a second account system and does
 * not hold a second copy of anybody's password: it is another front door onto the one identity.
 * Nothing about passwords, sessions, reset tokens, provider linking or the account document is
 * re-implemented in this repository. If a security property is wrong, it is wrong in one place
 * and fixed in one place.
 *
 * WHAT THIS FILE ACTUALLY IS. Configuration, and nothing else: take the bindings a Pages
 * Function is handed and build the service with them. The one Nova-specific setting is
 * `product`, which is how the account document records that somebody has used Nova — the same
 * seam Nova.Help fills in with 'nova.help'.
 *
 * MAIL. Password reset needs a transport and this deployment does not have one yet, exactly as
 * on Nova.Help. Without it the flow accepts requests, says the same neutral thing it always
 * says, and sends nothing — announced loudly rather than failing quietly. See
 * NovaHelp/docs/PASSWORD-RESET.md; when a transport is chosen it is configured in both places
 * and the shared package does the rest.
 */
import { createAccounts, createLogMailer } from '../../packages/nova-accounts/index.mjs';
import { createD1AccountStore } from '../../packages/nova-accounts/d1Store.mjs';

/**
 * Build the account service for one request.
 *
 * Cheap enough to do per request — it constructs a few closures over the binding and does no
 * I/O — and a Pages Function has no module-scope place to cache it that would survive an
 * isolate anyway.
 */
export async function accountsFor(env) {
  if (!env.DB) {
    throw new Error('The Nova site needs a D1 binding named DB — the same database Nova.Help uses.');
  }
  if (!env.NOVA_SECRET || String(env.NOVA_SECRET).length < 16) {
    throw new Error('NOVA_SECRET must be set to at least 16 characters, and must MATCH Nova.Help.');
  }

  return createAccounts({
    secret: env.NOVA_SECRET,
    store: createD1AccountStore({ db: env.DB }),
    /* Which product this front door is. Recorded on the account so "used with Nova" and "used
       with Nova.Help" are both true of one account rather than being two accounts. */
    product: 'nova',
    productName: 'Nova',
    supportUrl: 'https://nova-help.shadylabs.workers.dev/',
    /* The transport, in order of preference: one supplied as a binding, then the development
       log transport when explicitly asked for, then nothing — which makes reset accept
       requests and send none, loudly. A binding is how a real transport arrives too, so the
       tests exercise the same path a deployment will. */
    ...(env.MAILER?.send
      ? { mailer: env.MAILER }
      : env.NOVA_MAILER_DEV
        ? { mailer: createLogMailer({ logger: console }) }
        : {}),
    ...(env.NOVA_PASSWORD_COST_N
      ? { cost: { N: Number(env.NOVA_PASSWORD_COST_N), r: 8, p: 1 } }
      : {}),
  });
}

/**
 * THE SECRET MUST BE THE SAME ON BOTH SITES, and it is worth being explicit about why.
 *
 * A session token is signed with a key derived from this secret. Nova.Help derives the same key
 * from the same secret, so a token minted here verifies there and vice versa — which is what
 * makes one session usable across the ecosystem once both sit on one parent domain. Configure
 * two different secrets and you get two systems that share a database but not a session, and
 * the symptom is a cookie that silently stops working when you cross between products.
 */
export const SECRET_MUST_MATCH_NOVA_HELP = true;
