import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';
import type { VerifyCheckItem } from '@lobechat/types';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { AgentOperationItem } from '@/database/schemas/agentOperations';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { AiAgentService } from '@/server/services/aiAgent';

const buildEvidencePrompt = (
  items: VerifyCheckItem[],
): string => `The task execution is complete. Submit the evidence you produced for every Acceptance criterion below.

${items.map((item) => `- ${item.id}: ${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n')}

Call submitEvidence once for each criterion. This is evidence collection only: do not assign verdicts and do not redo the implementation.`;

/**
 * External CLI agents cannot call server builtin tools. Preserve their final
 * handoff as inline evidence instead of starting an evidence-only hetero turn
 * that can never reach `submitEvidence`.
 */
export const recordHeterogeneousDeliverableEvidence = async (params: {
  db: LobeChatDatabase;
  deliverable: string;
  operation: AgentOperationItem;
  plan: VerifyCheckItem[];
  userId: string;
  workspaceId?: string;
}) => {
  const { db, deliverable, operation, plan, userId, workspaceId } = params;
  const run = await new VerifyRunModel(db, userId, workspaceId).findByOperation(operation.id);
  if (!run) throw new Error('Verification run is missing for heterogeneous evidence');

  for (const item of plan) {
    const result = await new VerifyCheckResultModel(db, userId, workspaceId).upsertByCheckItem({
      checkItemId: item.id,
      checkItemIndex: item.index,
      checkItemTitle: item.title,
      operationId: operation.id,
      required: item.required,
      verifierType: item.verifierType,
      verifyRunId: run.id,
    });
    await new VerifyEvidenceModel(db, userId, workspaceId).createMany([
      {
        capturedAt: new Date(),
        capturedBy: 'agent',
        checkResultId: result.id,
        content: deliverable,
        description: 'Final deliverable reported by the heterogeneous builder.',
        documentId: null,
        fileId: null,
        type: 'text',
      },
    ]);
  }
};

export const startEvidenceSubmission = async (params: {
  db: LobeChatDatabase;
  deliverable: string;
  goal: string;
  operation: AgentOperationItem;
  plan: VerifyCheckItem[];
  userId: string;
  workspaceId?: string;
}): Promise<string> => {
  const { db, deliverable, goal, operation, plan, userId, workspaceId } = params;
  if (!operation.agentId || !operation.topicId) {
    throw new Error('Task operation has no builder agent or topic for evidence submission');
  }

  const parentOperationId = operation.id;
  const evidencePrompt = buildEvidencePrompt(plan);
  const hooks: AgentHook[] = [
    {
      handler: async () => {
        const { runVerifyAfterEvidenceSubmission } = await import('./lifecycle');
        await runVerifyAfterEvidenceSubmission(
          db,
          userId,
          {
            deliverable,
            goal,
            operationId: parentOperationId,
          },
          workspaceId,
        );
      },
      id: 'acceptance-evidence-on-complete',
      type: 'onComplete',
      webhook: {
        body: {
          deliverable,
          goal,
          parentOperationId,
          userId,
          ...(workspaceId ? { workspaceId } : {}),
        },
        delivery: 'qstash',
        fallback: 'none',
        url: '/api/workflows/verify/on-evidence-complete',
      },
    },
  ];

  const result = await new AiAgentService(db, userId, { workspaceId }).execAgent({
    agentId: operation.agentId,
    appContext: { taskId: operation.taskId, topicId: operation.topicId },
    autoStart: true,
    ephemeralUserMessage: evidencePrompt,
    exclusivePluginIds: [AcceptanceEvidenceIdentifier],
    hooks,
    parentOperationId,
    // Heterogeneous CLI adapters execute `prompt` directly, while the native
    // runtime also renders the ephemeral user message in the existing topic.
    // Keep both populated so this evidence-only continuation has an
    // instruction on every execution target.
    prompt: evidencePrompt,
    suppressUserMessage: true,
    userInterventionConfig: { approvalMode: 'headless' },
  });

  return result.operationId;
};
