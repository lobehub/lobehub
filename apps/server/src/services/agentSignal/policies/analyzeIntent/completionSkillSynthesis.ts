import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { messages } from '@lobechat/database/schemas';
import debug from 'debug';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';

import type { RuntimeProcessorContext } from '../../runtime/context';
import { defineSourceHandler } from '../../runtime/middleware';
import {
  type ActionSkillManagementHandle,
  AGENT_SIGNAL_POLICY_ACTION_TYPES,
  type AgentSignalFeedbackEvidence,
} from '../types';
import type { SkillManagementActionHandlerOptions } from './actions';
import { executeSkillManagementAction } from './actions';

const log = debug('lobe-server:agent-signal:completion-skill-synthesis');

/** Cap on the number of turn messages serialized into the trajectory context. */
const MAX_TRAJECTORY_MESSAGES = 40;

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

type CompletedTurnMessage = {
  content: string | null;
  id: string;
  role: string;
  tools: unknown;
};

interface CompletedTurnAnchors {
  /** Thread the completed turn ran under (assistant row), null on the main line. */
  threadId?: string;
  /** Start of the turn window — the initiating user message timestamp. */
  turnStartAt: Date;
  /** Id of the user message that initiated the completed turn. */
  userMessageId: string;
}

/**
 * Resolves the user message that initiated the completed turn by walking the
 * assistant message's parent chain (mirrors the `client.runtime.complete`
 * hydration). Returns undefined when the assistant message is missing, is not an
 * assistant turn, or has no user ancestor with content.
 */
const resolveCompletedTurnAnchors = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  assistantMessageId: string,
): Promise<CompletedTurnAnchors | undefined> => {
  const messageModel = new MessageModel(db, userId, workspaceId);
  const assistant = await messageModel.findById(assistantMessageId);
  if (!assistant || assistant.role !== 'assistant') return undefined;

  const threadId = assistant.threadId ?? undefined;
  let parentId = assistant.parentId;
  const visited = new Set<string>([assistant.id]);

  while (typeof parentId === 'string') {
    if (visited.has(parentId)) return undefined;
    visited.add(parentId);

    const parent = await messageModel.findById(parentId);
    if (!parent) return undefined;
    if (parent.role === 'user') {
      if (!parent.content) return undefined;
      return {
        ...(threadId ? { threadId } : {}),
        turnStartAt: parent.createdAt,
        userMessageId: parent.id,
      };
    }

    parentId = parent.parentId;
  }

  return undefined;
};

const renderToolCalls = (tools: unknown): string => {
  if (!Array.isArray(tools)) return '';

  return tools
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return '';
      const {
        apiName,
        arguments: args,
        identifier,
      } = tool as {
        apiName?: string;
        arguments?: string;
        identifier?: string;
      };
      const name = [identifier, apiName].filter(Boolean).join('.') || 'tool';
      const argText = typeof args === 'string' ? args : '';

      return `<tool_call name="${escapeXml(name)}">${escapeXml(argText)}</tool_call>`;
    })
    .filter(Boolean)
    .join('');
};

const renderTrajectoryMessage = (message: CompletedTurnMessage): string => {
  const content = escapeXml((message.content ?? '').trim());
  const toolCalls = message.role === 'assistant' ? renderToolCalls(message.tools) : '';

  return [
    `<message id="${escapeXml(message.id)}" role="${escapeXml(message.role)}">`,
    `<content>${content}</content>`,
    toolCalls,
    `</message>`,
  ].join('');
};

/**
 * Assembles the completed-turn trajectory (user request, the tool-call sequence,
 * tool results, and the final assistant product) into one XML envelope used as
 * the deferred skill synthesis context. This is the evidence the inbound prompt
 * alone could not provide (LOBE-10802 acceptance: evidence carries the tool
 * sequence + final product, not just the user prompt).
 */
const assembleTrajectoryContext = async (input: {
  db: LobeChatDatabase;
  threadId?: string;
  topicId: string;
  turnStartAt: Date;
  userId: string;
  workspaceId?: string;
}): Promise<{ serializedContext: string; toolNames: string[] }> => {
  const threadScopeFilter =
    typeof input.threadId === 'string'
      ? eq(messages.threadId, input.threadId)
      : isNull(messages.threadId);

  const rows = (await input.db.query.messages.findMany({
    columns: { content: true, id: true, role: true, tools: true },
    limit: MAX_TRAJECTORY_MESSAGES,
    orderBy: [asc(messages.createdAt)],
    where: and(
      buildWorkspaceWhere({ userId: input.userId, workspaceId: input.workspaceId }, messages),
      eq(messages.topicId, input.topicId),
      gte(messages.createdAt, input.turnStartAt),
      threadScopeFilter,
    ),
  })) as CompletedTurnMessage[];

  const toolNames = rows
    .filter((row) => row.role === 'assistant' && Array.isArray(row.tools))
    .flatMap((row) =>
      (row.tools as Array<{ apiName?: string; identifier?: string }>).map((tool) =>
        [tool?.identifier, tool?.apiName].filter(Boolean).join('.'),
      ),
    )
    .filter(Boolean);

  const serializedContext = [
    '<turn_trajectory>',
    rows.map(renderTrajectoryMessage).join(''),
    '</turn_trajectory>',
  ].join('');

  return { serializedContext, toolNames };
};

/**
 * Options for the deferred completion-stage skill synthesis source handler.
 * Reuses the skill-management action handler dependencies; `procedureState`
 * provides the parked-candidate store.
 */
export type CompletionSkillSynthesisOptions = SkillManagementActionHandlerOptions;

/**
 * Builds the `agent.execution.completed` source handler that performs deferred
 * skill synthesis (LOBE-10802).
 *
 * For a normal, non-error, non-self-iteration server execAgent turn it:
 * 1. Hydrates the completed turn (assistant -> user parent).
 * 2. Reads the candidate the inbound `agent.user.message` detect stage parked.
 * 3. Assembles the turn trajectory (tool sequence + final product) as context.
 * 4. Dispatches the skill-management run anchored to the assistant message,
 *    consuming the parked candidate so it synthesizes exactly once.
 *
 * Self-iteration completions (the skill run's own completion) carry a
 * `selfIteration` payload and are skipped, preventing recursion.
 */
export const createCompletionSkillSynthesisSourceHandler = (
  options: CompletionSkillSynthesisOptions,
) =>
  defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
    'agent.execution.completed:skill-synthesis',
    async (source, ctx: RuntimeProcessorContext): Promise<void> => {
      const payload = source.payload;
      // Self-iteration runs (including the skill-management run itself) carry a
      // marker-derived selfIteration payload — never re-synthesize from them.
      if (payload.selfIteration) return;
      // `agent.execution.completed` is reused for non-terminal pauses
      // (waiting_for_async_tool / waiting_for_human): the turn's final assistant
      // product doesn't exist yet, so synthesizing now would read a partial
      // trajectory and consume the parked candidate before the real completion.
      if (payload.reason === 'waiting_for_async_tool' || payload.reason === 'waiting_for_human') {
        return;
      }
      if (!options.selfIterationEnabled) return;

      const skillIntentRecords = options.procedureState?.skillIntentRecords;
      if (!skillIntentRecords?.read) return;

      const assistantMessageId = payload.assistantMessageId ?? payload.anchorMessageId;
      const { topicId } = payload;
      if (!assistantMessageId || !topicId) return;

      const anchors = await resolveCompletedTurnAnchors(
        options.db,
        options.userId,
        options.workspaceId,
        assistantMessageId,
      );
      if (!anchors) return;
      const { threadId, turnStartAt, userMessageId } = anchors;

      const record = await skillIntentRecords.read({
        scopeKey: ctx.scopeKey,
        sourceId: userMessageId,
      });
      // No parked candidate (or a client-runtime record without a synthesis
      // payload) — this turn is not a deferred skill candidate; no-op.
      if (!record?.pendingSynthesis) return;

      const { pendingSynthesis } = record;

      const { serializedContext, toolNames } = await assembleTrajectoryContext({
        db: options.db,
        ...(threadId ? { threadId } : {}),
        topicId,
        turnStartAt,
        userId: options.userId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      });

      const trajectoryEvidence: AgentSignalFeedbackEvidence[] = toolNames.length
        ? [
            {
              cue: 'completion_trajectory',
              excerpt: `Executed tools: ${[...new Set(toolNames)].join(', ')}`,
            },
          ]
        : [];

      const idempotencyKey = `${userMessageId}:skill:${userMessageId}`;
      const action: ActionSkillManagementHandle = {
        actionId: `${assistantMessageId}:completion:${userMessageId}:skill-management`,
        actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
        chain: { rootSourceId: userMessageId },
        payload: {
          ...((pendingSynthesis.agentId ?? payload.agentId)
            ? { agentId: pendingSynthesis.agentId ?? payload.agentId }
            : {}),
          assistantMessageId,
          ...(pendingSynthesis.conflictPolicy
            ? { conflictPolicy: pendingSynthesis.conflictPolicy }
            : {}),
          evidence: [...trajectoryEvidence, ...(pendingSynthesis.evidence ?? [])],
          idempotencyKey,
          message: pendingSynthesis.message,
          messageId: userMessageId,
          ...(record.reason ? { reason: record.reason } : {}),
          serializedContext,
          ...(pendingSynthesis.sourceHints ? { sourceHints: pendingSynthesis.sourceHints } : {}),
          topicId,
        },
        signal: {
          signalId: `${userMessageId}:skill-synthesis`,
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: source.sourceId, sourceType: source.sourceType },
        timestamp: source.timestamp,
      };

      log(
        '[completion-skill-synthesis] dispatching deferred skill synthesis user=%s assistant=%s op=%s tools=%d',
        userMessageId,
        assistantMessageId,
        payload.operationId,
        toolNames.length,
      );

      const result = await executeSkillManagementAction(action, options, ctx);

      // Consume the parked candidate so a duplicate completion (retry / repair)
      // cannot re-synthesize. Only on a genuine dispatch — a skipped idempotent
      // attempt already synthesized, and a failure should stay retryable.
      if (result.status === 'applied' && skillIntentRecords.write) {
        await skillIntentRecords.write({ ...record, pendingSynthesis: undefined });
      }
    },
  );
