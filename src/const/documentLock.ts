/**
 * Collaborative edit-lock tuning for workspace pages.
 *
 * The lock is a lease: the holder must refresh it (heartbeat) before it expires,
 * otherwise other members may take it over. There is no realtime channel, so the
 * client polls by re-acquiring on an interval.
 */

/**
 * How often the active editor refreshes its lock (and a waiting member retries
 * to take it over, and a locked-out viewer re-pulls the holder's content). Must
 * stay comfortably below the server lease TTL (`EDIT_LOCK_TTL_SECONDS`, 30s) so
 * a couple of missed beats still keep the lock alive. The lease lifetime itself
 * is owned server-side (Redis EX), not here.
 *
 * NOTE: this is a polling cadence — it bounds how stale the lock/content can be.
 * True low-latency sync needs a push channel (see the realtime-events issue);
 * this value is just the stopgap pulse.
 */
export const DOCUMENT_LOCK_HEARTBEAT_MS = 10 * 1000;
