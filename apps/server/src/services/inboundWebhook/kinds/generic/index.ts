import type { SignalItem } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import type { InboundWebhookViewOf } from '@/database/models/inboundWebhook';
import { TopicModel } from '@/database/models/topic';

import { isWebhookEnabled } from '../../featureGate';
import type { InboundWebhookKindHandler } from '../types';
import { parseGenericDelivery } from './delivery';
import { presentedToken, tokenMatches } from './token';
import { buildGenericWebhookPrompt, MAX_EVENTS_PER_PROMPT } from './wakePrompt';

/** The thread key of the Topic every call of a `reuse` webhook shares; a caller's key is never empty. */
const SHARED_THREAD = '';

/** The thread a delivery belongs to; undefined when it gets a Topic of its own. */
export const threadKeyOf = (
  row: InboundWebhookViewOf<'generic'>,
  signal: SignalItem,
): string | undefined =>
  signal.metadata.address?.threadKey ||
  (row.config.topicMode === 'reuse' ? SHARED_THREAD : undefined);

/** A thread's calls run together, and so do all calls without one, in one new Topic. */
const groupKeyOf = (row: InboundWebhookViewOf<'generic'>, signal: SignalItem) => {
  const key = threadKeyOf(row, signal);
  return key === undefined ? 'calls' : `thread:${key}`;
};

/**
 * A webhook any outside system can call with a secret URL (or `Authorization: Bearer`) to wake the
 * Agent. Each call starts a new Topic, or continues the Topic of its thread.
 */
export const genericKind: InboundWebhookKindHandler<'generic'> = {
  acknowledge: ({ id }, duplicate) =>
    duplicate
      ? { body: { duplicate: true, id }, status: 200 }
      : { body: { id, status: 'accepted' }, status: 202 },
  canCheck: false,
  groupKey: groupKeyOf,
  /**
   * The oldest group this wake has not given up on: a thread's oldest waiting calls, or all calls
   * without a thread, as many as one wake-up message carries. One wake runs one group; the rest
   * stay pending for the next wake.
   */
  groupSignals(row, signals, exclude) {
    const first = signals.find((signal) => !exclude.has(groupKeyOf(row, signal)));
    if (!first) return [];
    const key = groupKeyOf(row, first);
    return signals
      .filter((signal) => groupKeyOf(row, signal) === key)
      .slice(0, MAX_EVENTS_PER_PROMPT);
  },
  isEnabled: isWebhookEnabled,
  async parseDelivery(ctx, request) {
    if (ctx.row.status === 'paused')
      return { response: { error: 'Webhook is paused' }, status: 409 };
    return parseGenericDelivery(request);
  },
  async planWake(ctx) {
    const { batch, db, row } = ctx;
    const scope = row.workspaceId ?? undefined;
    if (row.status === 'paused') {
      await ctx.settle('ignored', 'webhook_paused');
      return { outcome: 'ignored' };
    }
    const threadKey = threadKeyOf(row, batch[0]);
    const topicModel = new TopicModel(db, row.userId, scope);
    // The shared Topic of a `reuse` webhook is the one its creator picked, while it is still the
    // agent's; otherwise (none picked, or it was deleted or moved) the webhook's own.
    const picked =
      threadKey === SHARED_THREAD && row.config.topicId
        ? await topicModel.findById(row.config.topicId)
        : undefined;
    const topic =
      picked && picked.agentId === row.agentId
        ? picked
        : threadKey === undefined
          ? undefined
          : await topicModel.findByWebhookThread({
              agentId: row.agentId,
              threadKey,
              webhookId: row.id,
            });
    const preferences = await ctx.intervention(db, row.userId);
    const name = row.name || 'Webhook';
    return {
      run: {
        externalOrigin: {
          kind: 'generic',
          label: name,
          provider: 'webhook',
          resourceId: row.id,
        },
        prompt: buildGenericWebhookPrompt({ row, signals: batch, threadKey }),
        ...(topic
          ? { topicId: topic.id }
          : {
              title: threadKey ? `${name} · ${threadKey}` : name,
              ...(threadKey !== undefined && {
                webhookThread: { threadKey, webhookId: row.id },
              }),
            }),
        // Never `headless`: it would skip tools that must always be confirmed.
        userInterventionConfig: row.config.autoApprove
          ? { allowList: preferences.allowList, approvalMode: 'auto-run' }
          : preferences,
      },
    };
  },
  signalSource: 'webhook',
  source: (row) => ({ ...row.config, kind: 'generic' }),
  /** The agent itself is checked by the waker; a generic webhook needs nothing else. */
  targetExists: async () => true,
  trigger: RequestTrigger.Webhook,
  verify: ({ request, secret }) => tokenMatches(presentedToken(request), secret),
};
