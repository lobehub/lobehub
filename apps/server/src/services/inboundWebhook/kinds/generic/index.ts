import type { SignalItem } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import type { InboundWebhookViewOf } from '@/database/models/inboundWebhook';
import { TopicModel } from '@/database/models/topic';

import { isAgentWebhooksEnabled } from '../../featureGate';
import type { InboundWebhookKindHandler } from '../types';
import { parseGenericDelivery } from './delivery';
import { presentedToken, tokenMatches } from './token';
import { buildGenericWebhookPrompt } from './wakePrompt';

/** The thread key of the Topic every call of a `reuse` webhook shares; a caller's key is never empty. */
const SHARED_THREAD = '';

/** The thread a delivery belongs to; undefined when it gets a Topic of its own. */
export const threadKeyOf = (
  row: InboundWebhookViewOf<'generic'>,
  signal: SignalItem,
): string | undefined =>
  signal.metadata.address?.threadKey ||
  (row.config.topicMode === 'reuse' ? SHARED_THREAD : undefined);

/** A thread's calls run together; a call without a thread runs alone. */
const groupKeyOf = (row: InboundWebhookViewOf<'generic'>, signal: SignalItem) => {
  const key = threadKeyOf(row, signal);
  return key === undefined ? `call:${signal.id}` : `thread:${key}`;
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
  deliveriesPerMinute: 120,
  groupKey: groupKeyOf,
  /** The oldest group this wake has not given up on: one call, or every waiting call of a thread. */
  groupSignals(row, signals, exclude) {
    const first = signals.find((signal) => !exclude.has(groupKeyOf(row, signal)));
    if (!first) return [];
    const key = groupKeyOf(row, first);
    return key.startsWith('call:')
      ? [first]
      : signals.filter((signal) => groupKeyOf(row, signal) === key);
  },
  isEnabled: isAgentWebhooksEnabled,
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
    const topic =
      threadKey === undefined
        ? undefined
        : await new TopicModel(db, row.userId, scope).findByWebhookThread({
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
  wakesPerHour: 60,
};
