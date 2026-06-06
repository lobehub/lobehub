import { ThreadType } from '@lobechat/types';
import debug from 'debug';

import { DocumentModel } from '@/database/models/document';
import { ThreadModel } from '@/database/models/thread';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { VerifyCheckItem, VerifyVerdict } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';

import type { VerifierAgentRunner } from './executor';
import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-agent-verifier');

/**
 * Parse the verifier sub-agent's final message into a verdict. The agent is
 * instructed to end with a `VERDICT: passed|failed|uncertain` line; a run that
 * did not finish cleanly (`reason !== 'done'`) is treated as `uncertain`.
 */
export const parseVerifierVerdict = (
  output: string,
  reason?: string,
): { reasoning: string; verdict: VerifyVerdict } => {
  if (reason && reason !== 'done') {
    return { reasoning: `Verifier agent did not finish (${reason}).`, verdict: 'uncertain' };
  }
  const match = output.match(/VERDICT:\s*(passed|failed|uncertain)/i);
  const verdict = (match?.[1]?.toLowerCase() as VerifyVerdict) ?? 'uncertain';
  return { reasoning: output.slice(0, 2000), verdict };
};

/** Build the instruction for a verifier sub-agent investigating one check. */
export const buildVerifierPrompt = (params: {
  checkItem: VerifyCheckItem;
  deliverable: string;
  goal: string;
  instruction?: string;
}): string => {
  const { checkItem, deliverable, goal, instruction } = params;
  return [
    'You are a delivery verifier sub-agent. Investigate whether the delivered work satisfies ONE specific check, using your tools to read files, run commands, and gather concrete evidence — do not trust the summary text alone.',
    `\n## Run goal\n${goal}`,
    `\n## Check to verify\n${checkItem.title}${instruction ? `\n${instruction}` : ''}`,
    deliverable ? `\n## Deliverable / final output\n${deliverable}` : '',
    '\n## Your task',
    '- Actively verify the check against the actual work. Read the relevant files / run the checks needed.',
    '- Be skeptical: only pass when you have concrete evidence; otherwise fail or mark uncertain.',
    '- This is a verification task, not a deliverable — do NOT create a delivery plan or call generateVerifyPlan.',
    '- Finish with a short justification, then a final line exactly one of: `VERDICT: passed`, `VERDICT: failed`, or `VERDICT: uncertain`.',
  ]
    .filter(Boolean)
    .join('\n');
};

/**
 * Build a {@link VerifierAgentRunner} that runs each `agent`-type check as a
 * verifier sub-agent: it creates an isolated thread, calls `execAgent` (headless)
 * reusing the run's own agent so the verifier has the same toolset, and attaches
 * an `onComplete` hook that parses the verdict and writes it back to the check
 * result. Returns `undefined` when the run has no agent/topic to run under (the
 * executor then marks agent items skipped).
 *
 * NOTE: the verdict hook runs in-process (local mode). Serialized/webhook hook
 * delivery for cloud execution is a follow-up.
 */
export const createVerifierAgentRunner = (params: {
  agentId?: string | null;
  db: LobeChatDatabase;
  deliverable: string;
  topicId?: string | null;
  userId: string;
}): VerifierAgentRunner | undefined => {
  const { agentId, db, deliverable, topicId, userId } = params;
  if (!agentId || !topicId) return undefined;

  return async ({ checkItem, goal, operationId }) => {
    const threadModel = new ThreadModel(db, userId);
    const thread = await threadModel.create({
      agentId,
      title: `Verify: ${checkItem.title}`,
      topicId,
      type: ThreadType.Isolation,
    });
    if (!thread) {
      log('failed to create verifier thread for check %s', checkItem.id);
      return null;
    }

    const verdictHook: AgentHook = {
      handler: async (event) => {
        const { reasoning, verdict } = parseVerifierVerdict(
          event.lastAssistantContent ?? '',
          event.reason,
        );
        await new VerifyCheckResultModel(db, userId).updateByCheckItem(operationId, checkItem.id, {
          completedAt: new Date(),
          status: verdict === 'passed' ? 'passed' : 'failed',
          toulmin: { reasoning },
          verdict,
        });
        await new VerifyStatusService(db, userId).recompute(operationId);
        log('verifier agent verdict for check %s: %s', checkItem.id, verdict);
      },
      id: `verify-verdict-${checkItem.id}`,
      type: 'onComplete',
    };

    // The detailed instruction is the criterion's rule body, stored in a document.
    const instruction = checkItem.documentId
      ? ((await new DocumentModel(db, userId).findById(checkItem.documentId))?.content ?? undefined)
      : undefined;

    // Dynamic import breaks the static cycle: aiAgent → agentRuntime completion
    // → verify lifecycle → this runner → aiAgent.
    const { AiAgentService } = await import('@/server/services/aiAgent');
    const result = await new AiAgentService(db, userId).execAgent({
      agentId,
      appContext: { threadId: thread.id, topicId },
      autoStart: true,
      hooks: [verdictHook],
      parentOperationId: operationId,
      prompt: buildVerifierPrompt({ checkItem, deliverable, goal, instruction }),
      userInterventionConfig: { approvalMode: 'headless' },
    });

    return { verifierOperationId: result.operationId };
  };
};
