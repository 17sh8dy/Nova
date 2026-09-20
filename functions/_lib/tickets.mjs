/**
 * What happens to a person's Nova.Help tickets when their account is deleted.
 *
 * THE DECISION: ANONYMISE, NEVER DELETE. A ticket is support history -- what went wrong, what
 * was tried, how it ended -- and that is worth keeping after the person who filed it has gone.
 * So the ticket stays, and everything that says WHO it was is removed.
 *
 * WHY THIS LIVES HERE AND NOT IN @nova/accounts. That package deliberately knows nothing about
 * tickets (see the top of its schema.sql). Nova.Help owns the `tickets` tables; the Nova site
 * shares the D1 database and so can reach them. This file is the one place the Nova site knows
 * their shape, and `test/manage.test.mjs` runs it against Nova.Help's real schema so a column
 * renamed over there fails a test here rather than failing a deletion in production.
 *
 * IT RUNS IN THE SAME TRANSACTION AS THE DELETE. `deleteAccount` puts these statements ahead
 * of `DELETE FROM accounts` in one D1 batch, so either the tickets are anonymised and the
 * account is gone, or nothing happened at all. There is no window in which an account is gone
 * and its tickets still carry its id, and none in which tickets are stripped of a name and the
 * account survives.
 *
 * WHAT CHANGES, on the tickets that carry this account id:
 *
 *   tickets.account_id            -> NULL.  The direct link. NULL is what a guest ticket already
 *                                   is, so nothing in Nova.Help needs to learn a new state.
 *   tickets.requester_name        -> NULL.
 *   tickets.requester_email       -> a random, meaningless address per ticket (the column is
 *                                   NOT NULL). NOT a shared placeholder: Nova.Help lets you open
 *                                   a ticket by ID plus the address it was filed with, comparing
 *                                   the address as text, so one well-known placeholder would let
 *                                   anybody holding a ticket ID open every anonymised ticket.
 *                                   A different random value each means there is no address to
 *                                   present.
 *   tickets.requester_email_hash  -> random per ticket, for the same reason: it is the "my
 *                                   tickets by address" lookup key, and a shared value would list
 *                                   every anonymised ticket under one address.
 *   tickets.source_ip             -> NULL.
 *   tickets.version               -> +1, so a write that read the ticket a moment ago fails and
 *                                   retries against the anonymised row instead of putting the
 *                                   name back.
 *   ticket_events.actor_name      -> 'Former user', on the events the REQUESTER wrote ('user'
 *                                   and 'assistant' actors; staff and system events are not
 *                                   personal data and keep their names).
 *
 * WHAT DOES NOT CHANGE, and is worth saying plainly:
 *
 *   - subject, description, event bodies. They are the support history. They are also free text
 *     a person typed, and if someone wrote their own name or phone number into one, this does
 *     not find it. Nothing can, short of rewriting what they said.
 *   - Attachments (the rows and the R2 objects). Their filenames are kept for the same reason.
 *   - Tickets filed as a GUEST. They were never linked to an account, so deleting an account
 *     neither finds nor changes them. They are reachable only by ID and address, as before.
 */

/** The prepared statements to run before the account row is deleted. */
export function anonymiseTicketsFor(accountId) {
  return (db) => [
    // First: the events are found THROUGH the ticket's account id, which the next statement clears.
    db
      .prepare(
        `UPDATE ticket_events
            SET actor_name = 'Former user'
          WHERE actor_kind IN ('user', 'assistant')
            AND actor_name IS NOT NULL
            AND ticket_id IN (SELECT id FROM tickets WHERE account_id = ?)`,
      )
      .bind(accountId),
    db
      .prepare(
        `UPDATE tickets
            SET account_id           = NULL,
                requester_name       = NULL,
                requester_email      = 'deleted-' || lower(hex(randomblob(12))) || '@nova.invalid',
                requester_email_hash = lower(hex(randomblob(32))),
                source_ip            = NULL,
                version              = version + 1
          WHERE account_id = ?`,
      )
      .bind(accountId),
  ];
}
