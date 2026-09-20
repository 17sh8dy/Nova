/**
 * Profile pictures in R2: the storage half. The package decides what a valid picture is and
 * what its key is called (`@nova/accounts` -> avatars.mjs); this file only moves bytes.
 *
 * THE BUCKET. There is no new bucket. Nova.Help already has `nova-help-attachments`, and the
 * Nova site binds the SAME bucket as `AVATARS`. Pictures live under `avatars/<accountId>/`,
 * ticket attachments under `tickets/<ticketId>/`, so the two never touch: nothing here reads
 * or writes outside `avatars/`, and Nova.Help never looks inside it. Every object this file
 * deletes is checked with `isAvatarKeyFor` first, because a key read back from a database row
 * is a claim, and a bad row must not be able to delete a ticket attachment.
 *
 * WHAT IS SERVED. Pictures are stored with the content type the package decided from their
 * bytes -- one of three fixed strings -- and served with `nosniff` and a CSP that forbids
 * everything, so even a file that somehow passed validation cannot be run as a page from the
 * origin that holds the account cookie.
 *
 * WHEN THE BINDING IS MISSING the feature reports itself unavailable rather than pretending;
 * `available(env)` is what the pages ask.
 */
import { avatarPrefix, isAvatarKeyFor, newAvatarKey } from '../../packages/nova-accounts/index.mjs';

export const available = (env) => Boolean(env?.AVATARS?.put && env?.AVATARS?.get && env?.AVATARS?.delete);

/**
 * Store a validated picture and point the account at it. `image` is the package's own verdict on
 * the bytes. The old object is removed only AFTER the new one is recorded, so a failure at any
 * step leaves the account with either its old picture or its new one, never neither.
 */
export async function saveAvatar({ env, accounts, accountId, bytes, image }) {
  const objectKey = newAvatarKey(accountId);
  await env.AVATARS.put(objectKey, bytes, { httpMetadata: { contentType: image.contentType } });

  const recorded = await accounts
    .setAvatar(accountId, { objectKey, contentType: image.contentType, size: bytes.byteLength })
    .catch((error) => ({ ok: false, error }));

  if (!recorded.ok) {
    // The row did not land, so the object is unreferenced. Do not leave it behind.
    await env.AVATARS.delete(objectKey).catch(() => {});
    return { ok: false };
  }
  await removeObject(env, accountId, recorded.previous);
  return { ok: true };
}

/** Remove the picture: the reference first, then the object it named. */
export async function removeAvatar({ env, accounts, accountId }) {
  const removed = await accounts.clearAvatar(accountId);
  await removeObject(env, accountId, removed);
  return Boolean(removed);
}

/** Delete one object named by a reference, if and only if it is a picture key for this account. */
async function removeObject(env, accountId, reference) {
  if (!reference || !isAvatarKeyFor(accountId, reference.objectKey)) return;
  await env.AVATARS.delete(reference.objectKey).catch(() => {});
}

/**
 * Remove everything stored for an account, by prefix. Used after an account is deleted, so it
 * also catches an object an interrupted upload left behind that no row ever pointed at.
 */
export async function purgeAvatars(env, accountId) {
  if (!available(env) || !env.AVATARS.list) return;
  const prefix = avatarPrefix(accountId);
  let cursor;
  do {
    const page = await env.AVATARS.list({ prefix, cursor });
    const keys = page.objects.map((object) => object.key).filter((key) => isAvatarKeyFor(accountId, key));
    if (keys.length) await env.AVATARS.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** The picture's bytes for the signed-in viewer, as a Response, or null if they have none. */
export async function avatarResponse(env, reference, accountId) {
  if (!reference || !available(env) || !isAvatarKeyFor(accountId, reference.objectKey)) return null;
  const object = await env.AVATARS.get(reference.objectKey);
  if (!object) return null;
  return new Response(object.body ?? (await object.arrayBuffer()), {
    headers: {
      'content-type': reference.contentType,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
      // Private to this person's browser; the page adds `?v=<updatedAt>` so a new picture
      // is fetched rather than the cached old one.
      'cache-control': 'private, max-age=3600',
    },
  });
}
