import { AcceptanceEvidenceIdentifier } from '@lobechat/builtin-tool-acceptance-evidence';
import type { VerifyCheckItem } from '@lobechat/types';

import type { AgentOperationItem } from '@/database/schemas/agentOperations';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { AiAgentService } from '@/server/services/aiAgent';

const buildEvidencePrompt = (
  items: VerifyCheckItem[],
): string => `The task execution is complete. Submit the evidence you produced for every Acceptance criterion below.

${items.map((item) => `- ${item.id}: ${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n')}

Call submitEvidence once for each criterion. This is evidence collection only: do not assign verdicts and do not redo the implementation.`;

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
    ephemeralUserMessage: buildEvidencePrompt(plan),
    exclusivePluginIds: [AcceptanceEvidenceIdentifier],
    hooks,
    parentOperationId,
    prompt: '',
    suppressUserMessage: true,
    userInterventionConfig: { approvalMode: 'headless' },
  });

  return result.operationId;
};
