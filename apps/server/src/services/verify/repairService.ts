import { DEFAULT_MAX_REPAIR_ROUNDS } from '@lobechat/const/verify';
import type { VerifyCheckItem, VerifyRunMetadata } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRubricModel } from '@/database/models/verifyRubric';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-repair');

/**
 * Resolve the run's repair-round cap. A per-run override on the session metadata
 * (set from the task's `TaskVerifyConfig.maxIterations`) wins, since a task with
 * ad-hoc criteria or a per-task cap may not carry it on a rubric. Otherwise read
 * it live from the rubric the plan was instantiated from (via the plan items'
 * `sourceRubricId`), falling back to {@link DEFAULT_MAX_REPAIR_ROUNDS} for
 * agent-generated / rubric-less plans.
 */
const resolveMaxRepairRounds = async (
  db: LobeChatDatabase,
  userId: string,
  plan: VerifyCheckItem[],
  metadata: VerifyRunMetadata | null | undefined,
  workspaceId?: string,
): Promise<number> => {
  if (typeof metadata?.maxRepairRounds === 'number') return metadata.maxRepairRounds;

  const rubricId = plan.find((i) => i.sourceRubricId)?.sourceRubricId;
  if (!rubricId) return DEFAULT_MAX_REPAIR_ROUNDS;

  const rubric = await new VerifyRubricModel(db, userId, workspaceId).findById(rubricId);
  return rubric?.config?.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS;
};

/**
 * Spawns a repair sub agent_operations (parent = the failed run) seeded with the
 * failed criteria. Injected by the runtime layer (Phase 7) since it needs full
 * runtime context. The new operation gets its own plan and is re-verified on its
 * own completion (the next "round").
 */
export interface RepairSpawner {
  (args: {
    failedItemIds: string[];
    instruction: string;
    operationId: string;
    /** The failed round's `role=verify` message carrying the persisted feedback. */
    verifyMessageId?: string;
  }): Promise<{ repairOperationId: string } | null>;
}

/** Count how many repair rounds already precede this operation (parent-chain depth). */
const countRepairRounds = async (
  operationModel: AgentOperationModel,
  operationId: string,
): Promise<number> => {
  let depth = 0;
  let current: string | null | undefined = operationId;
  while (current && depth < 10) {
    const op = await operationModel.findById(current);
    current = op?.parentOperationId;
    if (current) depth += 1;
  }
  return depth;
};

/**
 * Build a {@link RepairSpawner} for a run: when checks fail with `auto_repair`,
 * re-run the SAME agent in the same topic. The failure feedback is persisted on
 * the failed round's `role=verify` message (see VerifyRepairService) and surfaced
 * into the repair run's context by the VerifyMessageProcessor — so the repair op
 * runs off history (`suppressUserMessage`) rather than injecting a fake user turn.
 * Then it re-snapshots the plan onto the repair operation and confirms it so it
 * re-verifies on completion (next round). Caps the chain at `maxRepairRounds` to
 * avoid infinite repair loops.
 */
export const createRepairRunner = (params: {
  agentId?: string | null;
  db: LobeChatDatabase;
  maxRepairRounds: number;
  model?: string | null;
  provider?: string | null;
  topicId?: string | null;
  userId: string;
  workspaceId?: string;
}): RepairSpawner | undefined => {
  const { agentId, db, maxRepairRounds, model, provider, topicId, userId, workspaceId } = params;
  if (!agentId || !topicId) return undefined;

  return async ({ instruction, operationId, verifyMessageId }) => {
    const operationModel = new AgentOperationModel(db, userId, workspaceId);

    const round = await countRepairRounds(operationModel, operationId);
    if (round >= maxRepairRounds) {
      log('op %s reached max repair rounds (%d), not repairing', operationId, maxRepairRounds);
      return null;
    }

    // Re-run the original agent in the same topic. The feedback lives on the
    // verify message (surfaced into context by VerifyMessageProcessor), so we run
    // off history instead of injecting a user turn; `instruction` is passed only
    // for the operation title / logs. `verifyMessageId` parents the new turn under
    // the verify card it responds to.
    const result = await new AiAgentService(db, userId, { workspaceId }).execAgent({
      agentId,
      appContext: { topicId },
      autoStart: true,
      ...(model ? { model } : {}),
      ...(verifyMessageId ? { parentMessageId: verifyMessageId } : {}),
      parentOperationId: operationId,
      prompt: instruction,
      ...(provider ? { provider } : {}),
      suppressUserMessage: true,
      userInterventionConfig: { approvalMode: 'headless' },
    });
    const repairOperationId = result.operationId;

    // Re-snapshot the same plan onto the repair op's session + confirm, so the
    // repair run re-verifies (round N+1) against its corrected deliverable.
    const runModel = new VerifyRunModel(db, userId, workspaceId);
    const sourceRun = await runModel.findByOperation(operationId);
    const plan = (sourceRun?.plan ?? []) as VerifyCheckItem[];
    if (plan.length > 0) {
      const repairRun = await runModel.ensureForOperation(repairOperationId);
      await runModel.setPlan(repairRun.id, plan);
      // Carry the source run's policy bag (e.g. the task's maxRepairRounds
      // override) onto this round so its own auto-repair derives the same cap
      // instead of falling back to the rubric/default.
      if (sourceRun?.metadata) await runModel.setMetadata(repairRun.id, sourceRun.metadata);
      await runModel.confirmPlan(repairRun.id);
    }

    log('repair op %s → %s (round %d)', operationId, repairOperationId, round + 1);
    return { repairOperationId };
  };
};

/**
 * Trigger auto-repair once a run's verification has fully resolved. Safe to call
 * from any path that may have completed the last check (the inline LLM judge, or
 * an agent verifier's async writeback): it no-ops until every required check has
 * a terminal result, then — if any `auto_repair` check failed — re-runs the agent
 * with the failure feedback (a second iteration). Builds the repair runner from
 * the run's own agent/topic/model so the fix is produced by the original agent.
 */
export const maybeAutoRepair = async (
  db: LobeChatDatabase,
  userId: string,
  operationId: string,
  workspaceId?: string,
): Promise<void> => {
  const operationModel = new AgentOperationModel(db, userId, workspaceId);
  const run = await new VerifyRunModel(db, userId, workspaceId).findByOperation(operationId);
  const plan = (run?.plan ?? []) as VerifyCheckItem[];
  if (!run || plan.length === 0) return;

  const results = await new VerifyCheckResultModel(db, userId, workspaceId).listByRun(run.id);
  const byItem = new Map(results.map((r) => [r.checkItemId, r]));

  // Wait until every required check has a terminal result (don't repair early).
  const stillPending = plan
    .filter((i) => i.required)
    .some((i) => {
      const r = byItem.get(i.id);
      return !r || r.status === 'pending' || r.status === 'running';
    });
  if (stillPending) return;

  const op = await operationModel.findById(operationId);
  const spawner = createRepairRunner({
    agentId: op?.agentId,
    db,
    maxRepairRounds: await resolveMaxRepairRounds(
      db,
      userId,
      plan,
      run.metadata as VerifyRunMetadata | null,
      workspaceId,
    ),
    model: op?.model,
    provider: op?.provider,
    topicId: op?.topicId,
    userId,
    workspaceId,
  });
  await new VerifyRepairService(db, userId, workspaceId).triggerAutoRepair(operationId, spawner);
};

// `errored` = the verifier couldn't run (infra), so there's no delivery fault to
// repair — exclude it even though it carries no verdict.
const isFailed = (r: VerifyCheckResultItem | undefined): boolean =>
  !!r &&
  r.status !== 'errored' &&
  (r.status === 'failed' || r.verdict === 'failed' || r.verdict === 'uncertain');

const buildInstruction = (
  failures: { item: VerifyCheckItem; result: VerifyCheckResultItem | undefined }[],
): string => {
  const lines = failures.map(({ item, result }, i) => {
    const why = result?.suggestion || result?.toulmin?.reasoning || 'did not pass verification';
    return `${i + 1}. ${item.title} — ${why}`;
  });
  return [
    'The delivery checker found unresolved issues with the previous result. Fix only these, then stop:',
    ...lines,
  ].join('\n');
};

export class VerifyRepairService {
  private readonly messageModel: MessageModel;
  private readonly runModel: VerifyRunModel;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly statusService: VerifyStatusService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.messageModel = new MessageModel(db, userId, workspaceId);
    this.runModel = new VerifyRunModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.statusService = new VerifyStatusService(db, userId, workspaceId);
  }

  /** Collect the auto-repairable failures for a run. */
  async collectRepairable(operationId: string) {
    const run = await this.runModel.findByOperation(operationId);
    if (!run) return [];
    const plan = (run.plan ?? []) as VerifyCheckItem[];
    const results = await this.resultModel.listByRun(run.id);
    const byItem = new Map(results.map((r) => [r.checkItemId, r]));

    return plan
      .filter((item) => item.onFail === 'auto_repair' && isFailed(byItem.get(item.id)))
      .map((item) => ({ item, result: byItem.get(item.id) }));
  }

  /**
   * Trigger one round of auto-repair. Returns the repair operation id, or null
   * when there's nothing to repair or no spawner is available in this context.
   */
  async triggerAutoRepair(
    operationId: string,
    spawner?: RepairSpawner,
  ): Promise<{ repairOperationId: string } | null> {
    const failures = await this.collectRepairable(operationId);
    if (failures.length === 0) return null;
    if (!spawner) {
      log('auto-repair eligible for op %s but no spawner available', operationId);
      return null;
    }

    const failedItemIds = failures.map((f) => f.item.id);
    const instruction = buildInstruction(failures);

    // Persist the failure feedback onto this round's verify card so it (a) renders
    // and (b) is surfaced into the repair run's context by VerifyMessageProcessor
    // — the durable home of the round's repair prompt (structured backing data
    // still lives per-check on verify_check_results.suggestion / toulmin).
    const verifyMessage = await this.messageModel.findVerifyMessageByOperationId(operationId);
    if (verifyMessage) {
      await this.messageModel.update(verifyMessage.id, { content: instruction });
    } else {
      log('no verify message found for op %s — repair feedback not persisted to card', operationId);
    }

    const spawned = await spawner({
      failedItemIds,
      instruction,
      operationId,
      verifyMessageId: verifyMessage?.id,
    });
    if (!spawned) return null;

    // Link the repair operation onto each failed result and flip the rollup.
    const run = await this.runModel.findByOperation(operationId);
    if (run) {
      for (const { item } of failures) {
        await this.resultModel.updateByCheckItem(run.id, item.id, {
          repairOperationId: spawned.repairOperationId,
        });
      }
    }
    await this.statusService.markRepairing(operationId);
    log('triggered auto-repair op %s → %s', operationId, spawned.repairOperationId);

    return spawned;
  }
}
