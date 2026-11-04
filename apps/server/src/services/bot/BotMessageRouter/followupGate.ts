import { botWakeSchedulerCounter } from '@lobechat/observability-otel/modules/bot-wake';
import type { Message } from 'chat';
import debug from 'debug';

import { resolveChannelKeys } from '@/server/services/agentSignal/scenarios/botWake/facts';
import type { WakeScheduler } from '@/server/services/agentSignal/scenarios/botWake/scheduler';

import { deferBotMessages } from '../deferredMessages';
import { getOriginMessageId } from '../mergeMessages';
import type { BotWakeEntryPoint, BotWakeRecorder } from './wakeDecision';

const log = debug('lobe-server:bot:followup-gate');

export interface FollowupGateDeps {
  applicationId: string;
  observe: (
    entryPoint: BotWakeEntryPoint,
    message: Message,
    thread: { id: string },
    outcome: 'defer' | 'skip' | 'wake',
    reason: 'policy-denied' | 'scheduled',
    threadSubscribed?: boolean,
  ) => void;
  platform: string;
  recorder: Pick<BotWakeRecorder, 'enabled' | 'judge' | 'rememberEngaged'>;
  scheduler?: WakeScheduler;
}

export interface FollowupGateInput {
  entryPoint: BotWakeEntryPoint;
  /**
   * The message is addressed to the bot (it says the bot's name), so it is answered now like an
   * @mention instead of waiting for the scheduler's collect window. The scheduler exists to merge
   * a burst of chatter nobody addressed into one run; making someone who called the bot by name
   * wait for it only makes the bot look dead.
   */
  immediate?: boolean;
  /**
   * The wake came from `recorder.initiate`, which already ran the enforcing policies on this very
   * message; judging again would repeat a model call to reach the same answer.
   */
  initiated?: boolean;
  /** The message as it would run (merged text). */
  merged: Message;
  /** Every original message behind `merged`, oldest first; these are what gets parked. */
  parked: Message[];
  thread: { id: string };
  threadSubscribed?: boolean;
}

/**
 * The last check before a follow-up wake — one nobody addressed to the bot — starts a run.
 *
 * Use when:
 * - A watch keyword wakes the bot in a thread it was not mentioned in
 * - Never for @mention, DM, reply or command: those are answered at once and never come here
 *
 * Returns:
 * - `stop` when an enforcing wake policy denied it, or the scheduler parked it for a later run
 * - `proceed` otherwise. By default nothing enforces and no scheduler is configured, so this is
 *   `proceed` and the wake behaves exactly as it did before. A scheduler or Redis that cannot be
 *   reached also proceeds: failing open keeps the old behaviour rather than dropping the message.
 */
export const createFollowupGate = (deps: FollowupGateDeps) => {
  return async (input: FollowupGateInput): Promise<'proceed' | 'stop'> => {
    const { entryPoint, immediate, initiated, merged, parked, thread, threadSubscribed } = input;

    // Switch off: no judging, no scheduling, no parking. The wake runs exactly as it used to.
    if (!deps.recorder.enabled) return 'proceed';

    const decision = initiated
      ? undefined
      : await deps.recorder.judge({
          entryPoint,
          message: merged,
          outcome: 'wake',
          reason: 'watch-keyword',
          threadId: thread.id,
          threadSubscribed,
        });
    if (decision?.verdict === 'deny') {
      log('denied by %s: %s', decision.decidedBy, decision.reason);
      deps.observe(entryPoint, merged, thread, 'skip', 'policy-denied', threadSubscribed);

      return 'stop';
    }

    if (!deps.scheduler || immediate) return 'proceed';

    const { channelKey } = resolveChannelKeys(deps.platform, deps.applicationId, thread.id);
    // A replayed batch carries a fresh id; the scheduler parked the platform ids, so match on those.
    const parkedIds = parked.map((message) => getOriginMessageId(message));
    const verdict = await deps.scheduler.submit({
      channelKey,
      messages: parkedIds.map((id) => ({ id, threadId: thread.id })),
    });
    botWakeSchedulerCounter.add(1, { verdict });
    if (verdict !== 'hold') return 'proceed';

    // The scheduler will replay these and answer them. An edit that @-mentions the bot on one
    // meanwhile must not answer it first and leave the replay to answer it again.
    await deps.recorder.rememberEngaged(parkedIds);

    // The scheduler owns the message now; if it cannot be parked, run it rather than lose it.
    const stored = await deferBotMessages(deps.applicationId, thread.id, parked);
    if (!stored) return 'proceed';

    deps.observe(entryPoint, merged, thread, 'defer', 'scheduled', threadSubscribed);

    return 'stop';
  };
};

export type FollowupGate = ReturnType<typeof createFollowupGate>;
