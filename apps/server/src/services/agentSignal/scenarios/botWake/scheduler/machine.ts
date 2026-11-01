/**
 * Per-channel wake scheduler: `idle → collecting (≥ collectMs) → running → cooldown (≥ cooldownMs)`.
 *
 * Pure: it reads no clock and holds no timer. Callers pass the event time in, persist the
 * returned state, and carry out the returned effects (the delayed flush goes through the delay
 * queue, not an in-process timer). One channel has at most one run at a time.
 */

export type SchedulerPhase = 'collecting' | 'cooldown' | 'idle' | 'running';

/** A wake that arrived while the channel was not ready to run. */
export interface PendingWake {
  /** Epoch ms the message arrived. */
  at: number;
  messageId: string;
  /** Platform thread the parked message must be replayed in. */
  threadId: string;
}

export interface SchedulerState {
  /** `collecting`: earliest time the batch may be released. */
  collectUntil?: number;
  /** `cooldown`: earliest time the next batch may be collected. */
  cooldownUntil?: number;
  /** `running`: when the run is presumed dead and the channel is freed anyway. */
  leaseUntil?: number;
  /** Wakes waiting for a run, oldest first. */
  pending: PendingWake[];
  phase: SchedulerPhase;
  /** Message ids of the batch the current run was started for; these pass when replayed. */
  released: string[];
  runId?: string;
}

export interface SchedulerOptions {
  collectMs: number;
  cooldownMs: number;
  /** Longest a run may hold the channel before it is presumed dead. */
  runLeaseMs: number;
}

export const DEFAULT_RUN_LEASE_MS = 5 * 60 * 1000;

/** Upper bound on wakes parked for one channel; the oldest are dropped past it. */
export const MAX_PENDING_WAKES = 20;

export const IDLE_STATE: SchedulerState = { pending: [], phase: 'idle', released: [] };

export type SchedulerEvent =
  /** The delayed trigger fired (collect deadline, cooldown end, or lease watchdog). */
  | { at: number; type: 'flush' }
  /** A follow-up wake arrived. */
  | { at: number; messageId: string; threadId: string; type: 'message' }
  /** The run for this channel finished, replied or stayed silent. */
  | { at: number; runId?: string; type: 'runDone' };

export type SchedulerEffect =
  /** Fire a `flush` event at (or after) this time. */
  | { at: number; type: 'scheduleFlush' }
  /** Start the run: replay the parked messages of these threads. */
  | { messageIds: string[]; runId: string; threadIds: string[]; type: 'startRun' };

/**
 * What to do with the message that triggered a `message` event.
 *
 * - `hold`: park it; a later flush will release it
 * - `release`: it belongs to the batch being run now; let it through
 */
export type SchedulerDecision = 'hold' | 'release';

export interface SchedulerTransition {
  decision?: SchedulerDecision;
  effects: SchedulerEffect[];
  state: SchedulerState;
}

/** Books a flush unless the same one is already in the list. */
const bookFlush = (effects: SchedulerEffect[], at: number) => {
  if (!effects.some((effect) => effect.type === 'scheduleFlush' && effect.at === at)) {
    effects.push({ at, type: 'scheduleFlush' });
  }
};

const cloneState = (state: SchedulerState): SchedulerState => ({
  ...state,
  pending: [...state.pending],
  released: [...state.released],
});

const enterCooldown = (state: SchedulerState, at: number, options: SchedulerOptions) => {
  const next: SchedulerState = {
    cooldownUntil: at + options.cooldownMs,
    pending: state.pending,
    phase: 'cooldown',
    released: [],
  };

  return { effects: [{ at: next.cooldownUntil!, type: 'scheduleFlush' as const }], state: next };
};

/** Releases the pending batch into a run. */
const startRun = (
  state: SchedulerState,
  at: number,
  options: SchedulerOptions,
  runId: string,
): SchedulerTransition => {
  const threadIds = [...new Set(state.pending.map((wake) => wake.threadId))];
  const messageIds = state.pending.map((wake) => wake.messageId);
  const leaseUntil = at + options.runLeaseMs;

  return {
    effects: [
      { messageIds, runId, threadIds, type: 'startRun' },
      // The watchdog: a run that never reports back must not hold the channel forever.
      { at: leaseUntil, type: 'scheduleFlush' },
    ],
    state: { leaseUntil, pending: [], phase: 'running', released: messageIds, runId },
  };
};

/** Moves expired phases forward so every event starts from a state that is true at `at`. */
const settle = (
  input: SchedulerState,
  at: number,
  options: SchedulerOptions,
  newRunId: () => string,
): { effects: SchedulerEffect[]; state: SchedulerState } => {
  let state = input;
  let enteredCollecting = false;
  const effects: SchedulerEffect[] = [];

  if (state.phase === 'running' && state.leaseUntil !== undefined && at >= state.leaseUntil) {
    const cooled = enterCooldown(state, state.leaseUntil, options);
    state = cooled.state;
    effects.push(...cooled.effects);
  }

  if (
    state.phase === 'cooldown' &&
    state.cooldownUntil !== undefined &&
    at >= state.cooldownUntil
  ) {
    if (state.pending.length === 0) {
      // A copy: `IDLE_STATE` is shared and later steps append to `state.pending`.
      state = cloneState(IDLE_STATE);
    } else {
      // Wakes that arrived during the run or cooldown already waited; they still get the
      // minimum collect time counted from the first of them.
      const collectUntil = Math.max(at, state.pending[0].at + options.collectMs);
      state = { ...state, collectUntil, cooldownUntil: undefined, phase: 'collecting' };
      enteredCollecting = true;
    }
  }

  if (
    state.phase === 'collecting' &&
    state.collectUntil !== undefined &&
    at >= state.collectUntil
  ) {
    const started = startRun(state, at, options, newRunId());
    state = started.state;
    effects.push(...started.effects);
  } else if (
    state.phase === 'collecting' &&
    state.collectUntil !== undefined &&
    enteredCollecting
  ) {
    // Entered collecting from a cooldown: make sure a flush is booked for the deadline.
    effects.push({ at: state.collectUntil, type: 'scheduleFlush' });
  }

  return { effects, state };
};

/**
 * Applies one event to a channel's scheduler state.
 *
 * Expects:
 * - `newRunId` returns a fresh id each call; it is only read when a run starts
 *
 * Returns:
 * - the next state, the effects the caller must carry out, and for `message` events whether the
 *   message is held or released
 */
export const transitionScheduler = (
  previous: SchedulerState | undefined,
  event: SchedulerEvent,
  options: SchedulerOptions,
  newRunId: () => string,
): SchedulerTransition => {
  const settled = settle(cloneState(previous ?? IDLE_STATE), event.at, options, newRunId);
  let state = settled.state;
  const effects = [...settled.effects];

  switch (event.type) {
    case 'message': {
      // A message of the batch being run, replayed by the run itself.
      if (state.phase === 'running' && state.released.includes(event.messageId)) {
        return { decision: 'release', effects, state };
      }

      if (!state.pending.some((wake) => wake.messageId === event.messageId)) {
        state.pending = [
          ...state.pending,
          { at: event.at, messageId: event.messageId, threadId: event.threadId },
        ].slice(-MAX_PENDING_WAKES);
      }

      if (state.phase === 'idle') {
        const collectUntil = event.at + options.collectMs;
        state = { ...state, collectUntil, phase: 'collecting' };
        bookFlush(effects, collectUntil);
      }

      return { decision: 'hold', effects, state };
    }

    case 'runDone': {
      if (state.phase === 'running' && (!event.runId || event.runId === state.runId)) {
        const cooled = enterCooldown(state, event.at, options);
        state = cooled.state;
        effects.push(...cooled.effects);
      }

      return { effects, state };
    }

    case 'flush': {
      // `settle` already did the work a flush exists for; a flush that arrives early re-books.
      if (state.phase === 'collecting' && state.collectUntil !== undefined) {
        bookFlush(effects, state.collectUntil);
      } else if (state.phase === 'cooldown' && state.cooldownUntil !== undefined) {
        bookFlush(effects, state.cooldownUntil);
      }

      return { effects, state };
    }
  }
};
