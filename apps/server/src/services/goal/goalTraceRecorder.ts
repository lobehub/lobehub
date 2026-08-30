import {
  appendAdvanceToPartial,
  buildGoalTraceRollup,
  finalizeGoalTrace,
  type GoalAdvanceTrigger,
  type GoalTrajectory,
  type IGoalTraceStore,
  type RecordTickInput,
} from '@lobechat/agent-tracing';
import debug from 'debug';

import { GoalTraceModel } from '@/database/models/goalTrace';
import type { LobeChatDatabase } from '@/database/type';
import { buildGoalTraceKey } from '@/server/modules/GoalTracing';

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
    private readonly db: LobeChatDatabase,
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
      const trajectory = await appendAdvanceToPartial(this.store, this.goalId, {
        childOperationIds: [...this.operationIds],
        error: error
          ? { message: error instanceof Error ? error.message : String(error), type: 'advance' }
          : undefined,
        startedAt: this.startedAt,
        ticks: this.ticks,
        trigger: this.trigger,
      });
      if (trajectory) await this.writeObservationRow(trajectory);
    } catch (writeError) {
      log('failed to record advance for %s: %O', this.goalId, writeError);
    }
  }

  /**
   * Re-derive the observation row from the whole trajectory on every advance.
   *
   * Rewriting rather than incrementing is what makes it exact however often it
   * runs — an advance can be retried by the queue, and an additive counter
   * would drift. It also keeps the row queryable while the goal is still
   * running, which is when a stalling goal is worth finding.
   */
  private async writeObservationRow(trajectory: GoalTrajectory): Promise<void> {
    const rollup = buildGoalTraceRollup(trajectory);

    await new GoalTraceModel(this.db).upsert({
      advancesByOutcome: rollup.advancesByOutcome,
      advancesByTrigger: rollup.advancesByTrigger,
      advancesTotal: rollup.advancesTotal,
      completedAt: rollup.completedAt ? new Date(rollup.completedAt) : null,
      finalStatus: rollup.completionReason ?? null,
      findingsTotal: rollup.findingsTotal,
      gatesOpened: rollup.gatesOpened,
      gatesResolved: rollup.gatesResolved,
      goalId: this.goalId,
      humanWaitingMs: rollup.humanWaitingMs,
      nodesTotal: rollup.nodesTotal,
      startedAt: new Date(rollup.startedAt),
      ticksByBranch: rollup.ticksByBranch,
      ticksTotal: rollup.ticksTotal,
      traceS3Key: buildGoalTraceKey(this.goalId),
      workOperations: rollup.operationsTotal,
      // Columns kept as shipped. The node kind is now `task`, but renaming
      // three columns on a live table buys nothing the reporting names above
      // do not already give — so the mapping lives here, in one place.
      workResolved: rollup.tasksCompleted,
      workRetired: rollup.tasksRetired,
    });
  }

  /**
   * Close the trajectory once the goal itself is terminal. A goal that is only
   * parked keeps its partial, which readers still serve — an unfinished
   * long-horizon goal is the normal thing to inspect.
   */
  async finalize(completionReason: string): Promise<void> {
    if (!this.store) return;
    try {
      const trajectory = await finalizeGoalTrace(this.store, this.goalId, { completionReason });
      if (trajectory) await this.writeObservationRow(trajectory);
    } catch (error) {
      log('failed to finalize trajectory for %s: %O', this.goalId, error);
    }
  }
}

/** Goal statuses that end a trajectory. `paused` is a stop, not an end. */
export const TERMINAL_GOAL_STATUSES = new Set(['achieved', 'failed', 'canceled']);
