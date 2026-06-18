import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { VerifyCheckItem } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { DocumentModel } from '@/database/models/document';
import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';

import type { VerifierAgentRunner } from './executor';

const log = debug('lobe-server:verify-agent-verifier');

/**
 * Build the instruction for a verifier sub-agent investigating one check. The
 * sub-agent reports its verdict by calling the `submitVerifyResult` tool with the
 * `checkItemId` injected here — it does not write to the DB directly.
 */
export const buildVerifierPrompt = (params: {
  checkItem: VerifyCheckItem;
  deliverable: string;
  goal: string;
  instruction?: string;
}): string => {
  const { checkItem, deliverable, goal, instruction } = params;
  return [
    `## Check to verify\ncheckItemId: ${checkItem.id}\nTitle: ${checkItem.title}`,
    checkItem.description ? `Summary: ${checkItem.description}` : '',
    instruction ? `\n## Judging instruction\n${instruction}` : '',
    `\n## Run goal\n${goal}`,
    deliverable ? `\n## Deliverable / final output\n${deliverable}` : '',
    `\n## Your task\nInvestigate whether the deliverable satisfies this check, following the judging instruction. Gather concrete evidence. When done, call \`submitVerifyResult\` exactly once with checkItemId="${checkItem.id}" and your verdict (passed / failed / uncertain) plus evidence and reasoning.`,
  ]
    .filter(Boolean)
    .join('\n');
};

/**
 * Build a {@link VerifierAgentRunner} that runs each `agent`-type check as the
 * dedicated builtin **verify agent**: it materializes the verify agent, opens an
 * isolated thread, and `execAgent`s (headless) with the check context (incl.
 * `checkItemId`) injected into the prompt. The verify agent investigates and
 * writes its verdict back via the `submitVerifyResult` tool during its run — no
 * document creation, no output parsing, no external completion hook.
 */
export const createVerifierAgentRunner = (params: {
  db: LobeChatDatabase;
  deliverable: string;
  /** Inherit the parent run's model so the verifier uses a configured provider. */
  model?: string | null;
  provider?: string | null;
  topicId?: string | null;
  userId: string;
  workspaceId?: string;
}): VerifierAgentRunner | undefined => {
  const { db, deliverable, model, provider, topicId, userId, workspaceId } = params;
  if (!topicId) return undefined;

  return async ({ checkItem, goal, operationId }) => {
    // The detailed instruction is the criterion's rule body, stored in a document.
    const instruction = checkItem.documentId
      ? ((await new DocumentModel(db, userId, workspaceId).findById(checkItem.documentId))
          ?.content ?? undefined)
      : undefined;

    // Materialize the builtin verify agent (idempotent) to get an id for the thread.
    const verifyAgent = await new AgentModel(db, userId, workspaceId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.verifyAgent,
    );
    if (!verifyAgent) {
      log('verify agent unavailable, cannot run agent verifier for check %s', checkItem.id);
      return null;
    }

    const thread = await new ThreadModel(db, userId, workspaceId).create({
      agentId: verifyAgent.id,
      title: `Verify: ${checkItem.title}`,
      topicId,
      type: ThreadType.Isolation,
    });
    if (!thread) {
      log('failed to create verifier thread for check %s', checkItem.id);
      return null;
    }

    // Dynamic import breaks the static cycle: aiAgent → agentRuntime completion
    // → verify lifecycle → this runner → aiAgent.
    const { AiAgentService } = await import('@/server/services/aiAgent');
    const result = await new AiAgentService(db, userId, { workspaceId }).execAgent({
      appContext: { threadId: thread.id, topicId },
      autoStart: true,
      // Inherit the parent run's model/provider so the verifier uses a provider
      // that's actually configured (the builtin agent's default may not be).
      ...(model ? { model } : {}),
      parentOperationId: operationId,
      prompt: buildVerifierPrompt({ checkItem, deliverable, goal, instruction }),
      ...(provider ? { provider } : {}),
      slug: BUILTIN_AGENT_SLUGS.verifyAgent,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    return { verifierOperationId: result.operationId };
  };
};
