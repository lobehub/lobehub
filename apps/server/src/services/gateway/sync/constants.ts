/**
 * Cap on concurrent gateway calls during reconciliation. The gateway fans out
 * to one Durable Object per connection, so bursts mostly stress the Worker
 * router — this is about keeping the sync's own fetch fan-out (and DB status
 * writes) bounded as the connection count grows.
 */
export const GATEWAY_SYNC_CONCURRENCY = 8;

/**
 * Blast-radius cap for the stale-connection disconnect pass: even with
 * cleanup enforced, one sync round disconnects at most this many connections.
 * A desired-set bug can then cost one bounded, observable batch per cron round
 * instead of the whole fleet; genuine mass cleanup still converges over a few
 * rounds.
 */
export const GATEWAY_SYNC_STALE_DISCONNECT_LIMIT = 50;
