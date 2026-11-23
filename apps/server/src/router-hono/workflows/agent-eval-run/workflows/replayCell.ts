import { type WorkflowContext } from '@upstash/workflow';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { AgentEvalReplayService } from '@/server/services/agentEvalReplay';
import { type ReplayCellPayload } from '@/server/workflows/agentEvalRun';
import { resolveAgentEvalRunWorkspace } from '@/server/workflows/agentEvalRun/utils';
import { runStep } from '@/server/workflows/step';

const log = debug('lobe-server:workflows:replay-cell');

/**
 * Replay one frozen call against one model and judge the output.
 *
 * The cell is claimed (pending → running) inside the step, so a redelivered
 * request finds it no longer pending and never calls the model twice. The
 * last cell to finish closes the run and writes its per-target metrics.
 */
export const replayCellHandler = async (context: WorkflowContext<ReplayCellPayload>) => {
  const { cellId, runId, userId } = context.requestPayload ?? {};

  if (!cellId || !runId || !userId) {
    return { error: 'Missing cellId, runId or userId', success: false };
  }

  const db = await getServerDB();
  const wsId = await resolveAgentEvalRunWorkspace(db, runId);

  const cell = await runStep(context, 'agent-eval-run:replay-cell', async () => {
    const service = new AgentEvalReplayService(db, userId, wsId);
    const result = await service.executeCell(cellId);
    return result ? { id: result.id, status: result.status } : undefined;
  });

  log('Cell %s finished: %O', cellId, cell);
  return { cell, success: true };
};

export const replayCellWorkflowOptions = {
  flowControl: { key: 'agent-eval-run.replay-cell', parallelism: 20, rate: 10 },
};
