import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { VerifyToolIdentifier } from '@lobechat/builtin-tool-verify';
import type { VerifyCheckItem } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { DocumentModel } from '@/database/models/document';
import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook, AgentHookEvent } from '@/server/services/agentRuntime/hooks/types';
import { AiAgentService } from '@/server/services/aiAgent';

import type { VerifierAgentRunner } from './executor';
import { describeEvidence, type JudgeEvidence } from './prompts';
import { settleVerifierCheckFromTerminal } from './verifierTerminal';

const log = debug('lobe-server:verify-agent-verifier');

/**
 * Build the instruction for a verifier sub-agent investigating one check. The
 * sub-agent reports its verdict by calling the `submitVerifyResult` tool with the
 * `checkItemId` injected here — it does not write to the DB directly.
 *
 * `evidence` is what the builder self-captured during the run: the
 * verifier judges against the run goal AND this evidence — it's the verifier's
 * primary Data, not a competing verdict.
 */
export const buildVerifierPrompt = (params: {
  checkItem: VerifyCheckItem;
  deliverable: string;
  evidence?: JudgeEvidence[];
  goal: string;
  instruction?: string;
}): string => {
  const { checkItem, deliverable, evidence, goal, instruction } = params;
  const capturedEvidence = describeEvidence(evidence);
  return [
    `## Check to verify\ncheckItemId: ${checkItem.id}\nTitle: ${checkItem.title}`,
    checkItem.description ? `Summary: ${checkItem.description}` : '',
    instruction ? `\n## Judging instruction\n${instruction}` : '',
    `\n## Run goal\n${goal}`,
    deliverable ? `\n## Deliverable / final output\n${deliverable}` : '',
    capturedEvidence
      ? `\n## Captured evidence (builder self-evidence — primary Data, weight above prose)${capturedEvidence}`
      : '',
    `\n## Your task\nInvestigate whether the deliverable satisfies this check, judging against the run goal and the judging instruction. Weight the captured evidence above as primary Data; gather more yourself only where it's missing or insufficient. When done, call \`submitVerifyResult\` exactly once with checkItemId="${checkItem.id}" and your verdict (passed / failed / uncertain) plus evidence and reasoning.`,
  ]
    .filter(Boolean)
    .join('\n');
};

/**
 * Build a {@link VerifierAgentRunner} that runs each `agent`-type check as a
 * **verify agent**: it opens an isolated thread and `execAgent`s (headless) with
 * the check context (incl. `checkItemId`) injected into the prompt. The verify
 * agent investigates and writes its verdict back via the `submitVerifyResult`
 * tool during its run — no document creation, no output parsing, no external
 * completion hook.
 *
 * Which agent runs is selectable: when the task pins a `verifierAgentId`
 * (`TaskVerifyConfig.verifierAgentId`) that agent runs under its OWN agency
 * config (executionTarget / device / provider) — so picking a heterogeneous
 * agent (e.g. Codex) naturally gives the verifier device + browser access. When
 * unset (or the pinned agent no longer exists) it falls back to the builtin
 * verify agent, which receives a verify-safe provider/model resolved by the
 * lifecycle layer. That resolver intentionally filters heterogeneous runtime
 * identifiers (e.g. claude-code / codex) that cannot run LobeHub LLM calls.
 */
export const createVerifierAgentRunner = (params: {
  db: LobeChatDatabase;
  deliverable: string;
  /** Verify-safe model selected by the completion lifecycle. */
  model?: string | null;
  provider?: string | null;
  topicId?: string | null;
  userId: string;
  /** Task-pinned verify agent. Falls back to the builtin verify agent when unset/missing. */
  verifierAgentId?: string | null;
  workspaceId?: string;
}): VerifierAgentRunner | undefined => {
  const { db, deliverable, model, provider, topicId, userId, verifierAgentId, workspaceId } =
    params;
  if (!topicId) return undefined;

  return async ({ checkItem, evidence, goal, operationId }) => {
    // The detailed instruction is the criterion's rule body, stored in a document.
    const instruction = checkItem.documentId
      ? ((await new DocumentModel(db, userId, workspaceId).findById(checkItem.documentId))
          ?.content ?? undefined)
      : undefined;

    const agentModel = new AgentModel(db, userId, workspaceId);

    // Resolve which agent verifies. A pinned agent runs as itself (`agentId`) so
    // its own agency config drives execution target/provider — we don't override
    // its model/provider. The builtin fallback runs by `slug` with the verify-safe
    // model/provider selected by lifecycle.
    let threadAgentId: string;
    let agentRef: { agentId: string } | { slug: string };
    let useProvidedModelConfig = false;
    // A pinned agent (selected for its runtime/device) carries only its own
    // configured plugins, so it lacks the verify writeback tool — inject it, else
    // the verdict never lands and the check result is stuck `running`. The builtin
    // verify agent already declares this tool in its plugins, so it isn't re-added.
    let extraPluginIds: string[] = [];

    if (verifierAgentId && (await agentModel.existsById(verifierAgentId))) {
      threadAgentId = verifierAgentId;
      agentRef = { agentId: verifierAgentId };
      extraPluginIds = [VerifyToolIdentifier];
    } else {
      if (verifierAgentId) {
        log('pinned verify agent %s not found, falling back to builtin', verifierAgentId);
      }
      // Materialize the builtin verify agent (idempotent) to get an id for the thread.
      const builtin = await agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.verifyAgent);
      if (!builtin) {
        log('verify agent unavailable, cannot run agent verifier for check %s', checkItem.id);
        return null;
      }
      threadAgentId = builtin.id;
      agentRef = { slug: BUILTIN_AGENT_SLUGS.verifyAgent };
      useProvidedModelConfig = true;
    }

    const thread = await new ThreadModel(db, userId, workspaceId).create({
      agentId: threadAgentId,
      title: `Verify: ${checkItem.title}`,
      topicId,
      type: ThreadType.Isolation,
    });
    if (!thread) {
      log('failed to create verifier thread for check %s', checkItem.id);
      return null;
    }

    // Attach the builder-captured file artifacts (screenshots / videos / large
    // text) so a multimodal verifier can SEE them — the prompt only references
    // them by presence + caption, which is blind for visual checks.
    const evidenceFileIds = (evidence ?? [])
      .map((e) => e.fileId)
      .filter((id): id is string => Boolean(id));

    const terminalHookBody = {
      checkItemId: checkItem.id,
      parentOperationId: operationId,
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    };
    const hooks: AgentHook[] = [
      {
        handler: async (event: AgentHookEvent) => {
          await settleVerifierCheckFromTerminal(
            db,
            userId,
            {
              checkItemId: checkItem.id,
              errorMessage: event.errorMessage,
              parentOperationId: operationId,
              reason: event.reason,
              verifierOperationId: event.operationId,
            },
            workspaceId,
          );
        },
        id: 'verify-agent-terminal',
        type: 'onComplete' as const,
        webhook: {
          body: terminalHookBody,
          delivery: 'qstash' as const,
          url: '/api/workflows/verify/on-verifier-complete',
        },
      },
    ];

    // The aiAgent → agentRuntime completion → verify lifecycle → this runner →
    // aiAgent import cycle is safe statically: every use here is call-time (inside
    // this runner), so the module is fully initialized before it runs.
    const result = await new AiAgentService(db, userId, { workspaceId }).execAgent({
      // Inject the verify writeback tool for pinned agents (no-op list otherwise).
      ...(extraPluginIds.length ? { additionalPluginIds: extraPluginIds } : {}),
      appContext: { threadId: thread.id, topicId },
      autoStart: true,
      ...(evidenceFileIds.length ? { fileIds: evidenceFileIds } : {}),
      hooks,
      // Only the builtin fallback receives lifecycle's verify-safe model/provider;
      // a pinned agent keeps its own runtime config.
      ...(useProvidedModelConfig && model ? { model } : {}),
      parentOperationId: operationId,
      prompt: buildVerifierPrompt({ checkItem, deliverable, evidence, goal, instruction }),
      ...(useProvidedModelConfig && provider ? { provider } : {}),
      ...agentRef,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    return { verifierOperationId: result.operationId };
  };
};
