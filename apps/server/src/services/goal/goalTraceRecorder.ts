import {
  appendAdvanceToPartial,
  finalizeGoalTrace,
  type GoalAdvanceTrigger,
  type IGoalTraceStore,
  type RecordTickInput,
} from '@lobechat/agent-tracing';
import debug from 'debug';

import type { GoalTickObservation } from './traceObservation';
import { createDefaultGoalTraceStore } from './traceStore';

const log = debug('lobe-server:goal-trace');

/**
 * Collects one advance's ticks and writes them into the goal's trajectory.
 *
 * Recording is best-effort by construction: a goal that cannot be traced must
 * still advance. Every write is caught here so a storage outage degrades
 * observability instead of stalling long-horizon goals — the same posture the
 * operation snapshot recorder takes.
 */
export class GoalAdvanceRecorder {
  private readonly startedAt = Date.now();
  private readonly ticks: RecordTickInput[] = [];
  private readonly operationIds = new Set<string>();

  constructor(
    private readonly goalId: string,
    private readonly trigger: GoalAdvanceTrigger,
    private readonly store: IGoalTraceStore | null = createDefaultGoalTraceStore(),
  ) {}

  get enabled(): boolean {
    return this.store !== null;
  }

  /** Pass to `GoalService.tick`; undefined when tracing is off, so tick skips the work. */
  get onDecision(): ((observation: GoalTickObservation) => void) | undefined {
    if (!this.store) return undefined;
    return (observation) => {
      const { effects, graphState, ...rest } = observation;
      for (const effect of effects) {
        if (effect.operationId) this.operationIds.add(effect.operationId);
      }
      this.ticks.push({ ...rest, effects, graphState });
    };
  }

  async flush(error?: unknown): Promise<void> {
    if (!this.store || this.ticks.length === 0) return;

    try {
      await appendAdvanceToPartial(this.store, this.goalId, {
        childOperationIds: [...this.operationIds],
        error: error
          ? { message: error instanceof Error ? error.message : String(error), type: 'advance' }
          : undefined,
        startedAt: this.startedAt,
        ticks: this.ticks,
        trigger: this.trigger,
      });
    } catch (writeError) {
      log('failed to record advance for %s: %O', this.goalId, writeError);
    }
  }

  /**
   * Close the trajectory once the goal itself is terminal. A goal that is only
   * parked keeps its partial, which readers still serve — an unfinished
   * long-horizon goal is the normal thing to inspect.
   */
  async finalize(completionReason: string): Promise<void> {
    if (!this.store) return;
    try {
      await finalizeGoalTrace(this.store, this.goalId, { completionReason });
    } catch (error) {
      log('failed to finalize trajectory for %s: %O', this.goalId, error);
    }
  }
}

/** Goal statuses that end a trajectory. `paused` is a stop, not an end. */
export const TERMINAL_GOAL_STATUSES = new Set(['achieved', 'failed', 'canceled']);
