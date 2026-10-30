import { botWakeRetentionCounter } from '@lobechat/observability-otel/modules/bot-wake';
import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import type { SignalRetentionConfig } from '@/server/services/agentSignal/persistence/retention';
import { sweepSignals } from '@/server/services/agentSignal/persistence/retention';

const log = debug('lobe-server:workflows:agent-signal:prune-signals');

/**
 * Periodic retention sweep over the `signals` log — see {@link sweepSignals}.
 *
 * No per-user authentication: this is a global scan registered as a QStash Schedule (e.g.
 * `0 * * * *`) pointing at `/api/workflows/agent-signal/prune-signals`; signature verification is
 * the `qstashAuth` middleware on the route. An optional JSON body tunes the tick:
 * `{ keepPerSource?, payloadTtlHours?, limit? }`.
 */
export async function pruneSignals(c: Context) {
  try {
    const body = await c.req
      .json<SignalRetentionConfig>()
      .catch(() => ({}) as SignalRetentionConfig);
    const db = await getServerDB();
    const outcome = await sweepSignals(db, body ?? {});

    botWakeRetentionCounter.add(outcome.deleted, { kind: 'pruned' });
    botWakeRetentionCounter.add(outcome.purgedPayloads, { kind: 'payload_purged' });
    log(
      'Signal retention: buckets=%d deleted=%d purgedPayloads=%d',
      outcome.buckets,
      outcome.deleted,
      outcome.purgedPayloads,
    );
    return c.json({ ...outcome, success: true });
  } catch (error) {
    console.error('[agent-signal/prune-signals] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
