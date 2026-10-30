import { randomUUID } from 'node:crypto';

import debug from 'debug';

import type {
  SchedulerDecision,
  SchedulerEffect,
  SchedulerEvent,
  SchedulerOptions,
  SchedulerState,
  SchedulerTransition,
} from './machine';
import { DEFAULT_RUN_LEASE_MS, transitionScheduler } from './machine';

const log = debug('lobe-server:bot:wake-scheduler');

/** Persists one channel's scheduler state; applies `mutate` atomically. */
export interface SchedulerStore {
  mutate: <TResult>(
    channelKey: string,
    mutate: (state: SchedulerState | undefined) => { result: TResult; state: SchedulerState },
  ) => Promise<TResult | undefined>;
}

/**
 * A delay queue the scheduler books its delayed `flush` on. Implemented over the job queue
 * (QStash), never an in-process timer, so a restart cannot lose a pending flush.
 */
export interface SchedulerDelayQueue {
  scheduleFlush: (input: { at: number; channelKey: string }) => Promise<void>;
}

export interface SchedulerRunTarget {
  channelKey: string;
  messageIds: string[];
  runId: string;
  threadIds: string[];
}

export interface WakeSchedulerDeps {
  delayQueue: SchedulerDelayQueue;
  now?: () => number;
  options: Omit<SchedulerOptions, 'runLeaseMs'> & { runLeaseMs?: number };
  /** Replays the parked messages of the batch so the run starts. */
  startRun: (target: SchedulerRunTarget) => Promise<void>;
  store: SchedulerStore;
}

export interface SubmitWakeInput {
  channelKey: string;
  messages: { id: string; threadId: string }[];
}

/**
 * Per-channel wake scheduler: serializes follow-up wakes so a channel never has two runs, and
 * spaces them out (collect ≥ 20s, cooldown ≥ 60s by default).
 *
 * Use when:
 * - A follow-up wake (one nobody addressed to the bot) is about to start a run
 * - Never for @mention, reply, DM or command: those are answered immediately
 *
 * Expects:
 * - Every state change goes through the store's atomic `mutate`; the delayed `flush` comes back
 *   through the delay queue, possibly more than once and possibly early, and is idempotent
 */
export class WakeScheduler {
  constructor(private readonly deps: WakeSchedulerDeps) {}

  private get options(): SchedulerOptions {
    return { runLeaseMs: DEFAULT_RUN_LEASE_MS, ...this.deps.options };
  }

  private async apply(
    channelKey: string,
    events: (now: number) => SchedulerEvent[],
  ): Promise<{ decisions: SchedulerDecision[]; effects: SchedulerEffect[] } | undefined> {
    const now = (this.deps.now ?? Date.now)();
    const options = this.options;

    const outcome = await this.deps.store.mutate(channelKey, (stored) => {
      let state = stored;
      const decisions: SchedulerDecision[] = [];
      const effects: SchedulerEffect[] = [];

      for (const event of events(now)) {
        const step: SchedulerTransition = transitionScheduler(state, event, options, randomUUID);
        state = step.state;
        effects.push(...step.effects);
        if (step.decision) decisions.push(step.decision);
      }

      return { result: { decisions, effects }, state: state! };
    });

    if (!outcome) return;

    await this.runEffects(channelKey, outcome.effects);

    return outcome;
  }

  private async runEffects(channelKey: string, effects: SchedulerEffect[]) {
    for (const effect of effects) {
      try {
        if (effect.type === 'scheduleFlush') {
          await this.deps.delayQueue.scheduleFlush({ at: effect.at, channelKey });
        } else {
          await this.deps.startRun({
            channelKey,
            messageIds: effect.messageIds,
            runId: effect.runId,
            threadIds: effect.threadIds,
          });
        }
      } catch (error) {
        // A booked flush that fails is recovered by the next message or by the lease watchdog;
        // a failed start leaves the batch parked in `released` until the lease frees the channel.
        log('effect %s failed for %s: %O', effect.type, channelKey, error);
      }
    }
  }

  /**
   * Registers follow-up wakes and says what to do with them.
   *
   * Returns:
   * - `hold` when the messages must be parked until the scheduler releases them
   * - `release` when they are the batch the scheduler is running (a replay) and may proceed
   * - `unavailable` when the state store could not be reached; the caller wakes immediately,
   *   which is what the pipeline did before the scheduler existed
   */
  async submit(input: SubmitWakeInput): Promise<'hold' | 'release' | 'unavailable'> {
    const outcome = await this.apply(input.channelKey, (now) =>
      input.messages.map((message) => ({
        at: now,
        messageId: message.id,
        threadId: message.threadId,
        type: 'message' as const,
      })),
    );

    if (!outcome) return 'unavailable';

    return outcome.decisions.includes('hold') ? 'hold' : 'release';
  }

  /** The delay queue fired. Carries out whatever the elapsed time makes due. */
  async flush(channelKey: string): Promise<void> {
    await this.apply(channelKey, (now) => [{ at: now, type: 'flush' }]);
  }

  /** The run for this channel finished (replied, stayed silent, or failed). */
  async runDone(channelKey: string, runId?: string): Promise<void> {
    await this.apply(channelKey, (now) => [{ at: now, runId, type: 'runDone' }]);
  }
}
