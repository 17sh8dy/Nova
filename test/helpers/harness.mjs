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
import { applySchema } from '../../../NovaHelp/server/store/migrate.mjs';

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
export async function createSite(
  t,
  { db: shared = null, mailer: sharedMailer = null, bucket = true, limiter = false } = {},
) {
  const db = shared ?? createSqliteD1();
  if (!shared) {
    /* The WHOLE shared schema, tickets included: in production the Nova site and Nova.Help share
       one database, and deleting an account has to reach the tickets. */
    await applySchema(db);
    t.after(() => db.close());
  }

  const mailer = sharedMailer ?? createMemoryMailer();

  const env = {
    DB: db,
    NOVA_SECRET: SECRET,
    NOVA_PASSWORD_COST_N: CHEAP_N,
    // Cookies without Secure, so a plain http test client keeps them.
    NOVA_INSECURE_COOKIES: '1',
    // R2, when asked for. `bucket: false` is a deployment without the binding.
    ...(bucket ? { AVATARS: createFakeBucket() } : {}),
    ...(limiter ? { RATE_LIMITER: createFakeLimiter() } : {}),
  };

  return { db, env, mailer, jar: new Map() };
}

/** The slice of R2 the site uses, over a Map. Keys and metadata are inspectable in tests. */
export function createFakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes: new Uint8Array(bytes), httpMetadata: options.httpMetadata ?? {} });
    },
    async get(key) {
      const held = objects.get(key);
      if (!held) return null;
      return {
        body: new Blob([held.bytes]).stream(),
        arrayBuffer: async () => held.bytes.slice().buffer,
        httpMetadata: held.httpMetadata,
      };
    },
    async delete(keys) {
      for (const key of [].concat(keys)) objects.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false };
    },
  };
}

/** A Durable Object namespace that counts, so the router's limiter is genuinely enforced. */
export function createFakeLimiter() {
  const counts = new Map();
  return {
    idFromName: (name) => name,
    get: (id) => ({
      async hit(_windowMs, max) {
        const n = (counts.get(id) ?? 0) + 1;
        counts.set(id, n);
        return n > max ? { ok: false, retryAfter: 60 } : { ok: true, retryAfter: 0 };
      },
      async clear() {
        counts.delete(id);
      },
    }),
  };
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
    /** A file upload, as a browser sends one. `claimedType` is what the browser SAYS it is. */
    upload: async (path, bytes, { name = 'avatar', filename = 'me.png', claimedType = 'image/png', headers = {} } = {}) => {
      const form = new FormData();
      form.set(name, new Blob([bytes], { type: claimedType }), filename);
      /* Encoded here so the request carries a Content-Length, as every browser's does. */
      const encoded = new Response(form);
      const body = new Uint8Array(await encoded.arrayBuffer());
      return call(path, {
        method: 'POST',
        body,
        headers: { 'content-type': encoded.headers.get('content-type'), 'content-length': String(body.byteLength), ...headers },
      });
    },
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
