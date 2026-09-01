/**
 * A Pages Function, exercised the way Cloudflare exercises it.
 *
 * The account router is `onRequest(context)` taking a real `Request` and returning a real
 * `Response`, so it can be driven directly with no server, no port and no wrangler — the code
 * under test is exactly the code that would be deployed.
 *
 * WHAT IS REAL HERE, because that is what makes these tests worth anything:
 *
 *   - the `@nova/accounts` package, unmodified — the same one Nova.Help runs
 *   - a real SQLite engine behind the D1 interface, via NovaHelp's sqliteD1 driver
 *   - the real account schema, applied from the package
 *
 * WHAT IS SIMULATED: the Durable Object rate limiter (omitted, so the router takes its
 * unenforced path) and the mail transport (an array). Both are covered properly by Nova.Help's
 * own suite against the real runtime.
 *
 * The D1 driver is imported from the NovaHelp repo rather than copied. It is a local
 * development tool, not part of the shipped package, and having one copy of it means a fix
 * there is a fix here.
 */
import { createMemoryMailer } from '@nova/accounts';
import { createSqliteD1 } from '../../../NovaHelp/server/store/sqliteD1.mjs';
import { applyAccountSchema } from '../../../NovaHelp/server/store/migrate.mjs';

import { onRequest } from '../../functions/account/[[path]].mjs';

const SECRET = 'a-test-signing-secret-of-sufficient-length';

/** Cheap scrypt: the record shape is identical, the suite does not burn minutes on arithmetic. */
const CHEAP_N = '1024';

/**
 * A site with its own database, or sharing one that already exists.
 *
 * Passing another site's `db` is how the cross-product tests are written: two front doors, one
 * database, and therefore one account. That is the whole architecture in one parameter.
 */
export async function createSite(t, { db: shared = null, mailer: sharedMailer = null } = {}) {
  const db = shared ?? createSqliteD1();
  if (!shared) {
    await applyAccountSchema(db);
    t.after(() => db.close());
  }

  const mailer = sharedMailer ?? createMemoryMailer();

  const env = {
    DB: db,
    NOVA_SECRET: SECRET,
    NOVA_PASSWORD_COST_N: CHEAP_N,
    // Cookies without Secure, so a plain http test client keeps them.
    NOVA_INSECURE_COOKIES: '1',
  };

  return { db, env, mailer, jar: new Map() };
}

/**
 * A browser-ish client against one site: a cookie jar, and redirects left alone so the tests
 * can assert on them.
 */
export function browser(site, { mailerOverride = null } = {}) {
  const jar = new Map();

  const stash = (response) => {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
  };

  const cookieHeader = () => [...jar].map(([n, v]) => `${n}=${v}`).join('; ');

  const call = async (path, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (jar.size) headers.set('cookie', cookieHeader());
    headers.set('cf-connecting-ip', init.ip ?? '203.0.113.10');

    const request = new Request(`https://nova.test${path}`, { ...init, headers });

    /* The mailer must be the SAME instance the assertions read, and the router builds its own
       service per request — so it arrives as a binding, which is exactly how a real transport
       will arrive too. */
    const env = { ...site.env, MAILER: mailerOverride ?? site.mailer };
    const response = await onRequest({ request, env, params: {} });
    stash(response);
    return response;
  };

  return {
    jar,
    cookieHeader,
    get: (path, init) => call(path, { method: 'GET', ...init }),
    post: (path, fields, init = {}) =>
      call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        ...init,
      }),
  };
}

/** The reset link from the most recent message, as a path. */
export function linkFrom(mailer) {
  const last = mailer.sent.at(-1);
  if (!last) throw new Error('no mail was sent');
  const found = /https?:\/\/[^\s]+\/account\/reset\?token=[^\s]+/.exec(last.text);
  if (!found) throw new Error(`no reset link in:\n${last.text}`);
  const url = new URL(found[0]);
  return url.pathname + url.search;
}

export const tokenFrom = (mailer) => new URLSearchParams(linkFrom(mailer).split('?')[1]).get('token');

export const PASSWORD = 'a passphrase nobody guesses';
export const NEW_PASSWORD = 'an entirely different passphrase';
