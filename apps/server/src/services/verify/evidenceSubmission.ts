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
 * Stable id of the onComplete hook the evidence turn runs under. The sweep
 * identifies the evidence continuation among the builder's sub-operations by
 * carrying this hook in its persisted runtime state — an operation itself
 * carries no marker, and the builder may have other children from sub-agents.
 */
export const EVIDENCE_HOOK_ID = 'acceptance-evidence-on-complete';

/**
 * External CLI agents cannot call server builtin tools. Preserve their final
 * handoff as inline evidence instead of starting an evidence-only hetero turn
 * that can never reach `submitEvidence`.
 *
 * Only criteria the builder left without any evidence get the handoff. A
 * criterion it already evidenced through `lh acceptance run result submit`
 * keeps exactly what it submitted, as an Acceptance round does: the final
 * report is not evidence for a specific check and is already handed to the
 * verifier as the deliverable.
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

  // One transaction: a half-written backfill is indistinguishable from a builder
  // that submitted only some evidence, so the caller's retry would take the
  // partial-evidence branch and never hand the remaining criteria the frozen
  // deliverable. All-or-nothing keeps "no evidence yet" meaning exactly that.
  await db.transaction(async (tx) => {
    const txDB = tx as unknown as LobeChatDatabase;

    const run = await new VerifyRunModel(txDB, userId, workspaceId).findByOperation(operation.id);
    if (!run) throw new Error('Verification run is missing for heterogeneous evidence');

    const evidenced = new Set(
      (await new VerifyEvidenceModel(txDB, userId, workspaceId).listByRun(run.id)).map(
        (row) => row.checkItemId,
      ),
    );

    for (const item of plan) {
      if (evidenced.has(item.id)) continue;

      const result = await new VerifyCheckResultModel(txDB, userId, workspaceId).upsertByCheckItem({
        checkItemId: item.id,
        checkItemIndex: item.index,
        checkItemTitle: item.title,
        operationId: operation.id,
        required: item.required,
        verifierType: item.verifierType,
        verifyRunId: run.id,
      });
      await new VerifyEvidenceModel(txDB, userId, workspaceId).createMany([
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
  });
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
      id: EVIDENCE_HOOK_ID,
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
