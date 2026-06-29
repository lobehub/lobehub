import { type AgentState } from '@lobechat/agent-runtime';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { type OperationToolSet } from '@lobechat/context-engine';
import { type ToolType } from '@lobechat/observability-otel/modules/agent-runtime';
import { type ChatToolPayload, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import { type LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';
import {
  type ServerAgentMemberRunner,
  type ServerSubAgentRunner,
  type ToolExecutionResultResponse,
} from '@/server/services/toolExecution';
import { archiveToolResultIfNeeded } from '@/server/services/toolExecution/archiveToolResult';

import { type RuntimeExecutorContext } from './context';
import { type LLMErrorKind } from './llmErrorClassification';
import { ModelEmptyError } from './ModelEmptyError';

export const log = debug('lobe-server:agent-runtime:streaming-executors');
export const timing = debug('lobe-server:agent-runtime:timing');

// Tool pricing configuration (USD per call)
export const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0,
  'lobe-web-browsing/search': 0,
};

export const TOOL_MAX_RETRIES = 2;
const LLM_MAX_RETRIES = 5;
const LLM_RETRY_BASE_DELAY_MS = 1000;
const LLM_RETRY_MAX_DELAY_MS = 30_000;

/**
 * Retry budget for empty completions, applied independently of
 * `resolveLLMMaxRetries`. The branded provider gets 0 general retries because
 * its own fallback chain already re-routes failed requests — but an
 * HTTP-200-but-empty turn never triggered that chain, so it must still be
 * re-issued. A small budget is enough: empty turns almost always self-heal on
 * the first retry.
 */
const EMPTY_COMPLETION_MAX_RETRIES = 2;

/**
 * Output-token count at or below this — combined with no content, reasoning,
 * tool calls, or images — marks a turn as an empty completion.
 * The observed failure case reported `out=1 token`.
 */
const EMPTY_COMPLETION_MAX_OUTPUT_TOKENS = 1;

/**
 * Detect the "empty completion" failure mode: the model returns a
 * turn with no text, no reasoning, no tool calls, no images, and ~0 output
 * tokens — typically after a stalled tool loop where it effectively gives up.
 * Callers throw `ModelEmptyError` on a hit so the LLM retry loop re-attempts
 * instead of silently finalizing to `done` with a blank assistant message.
 */
export const isEmptyModelCompletion = (params: {
  content: string;
  imageCount: number;
  outputTokens: number | undefined;
  reasoning: string;
  toolCallCount: number;
}): boolean => {
  const { content, reasoning, toolCallCount, imageCount, outputTokens } = params;

  if (content.trim().length > 0) return false;
  if (reasoning.trim().length > 0) return false;
  if (toolCallCount > 0) return false;
  if (imageCount > 0) return false;

  // When the provider reports output tokens, only treat as empty if it's ~0.
  // Guards against rare cases where structured output we don't accumulate into
  // `content`/`reasoning` here (e.g. grounding) still consumed real tokens.
  if (typeof outputTokens === 'number' && outputTokens > EMPTY_COMPLETION_MAX_OUTPUT_TOKENS) {
    return false;
  }

  return true;
};

type ReasoningReplayNode = {
  children?: ReasoningReplayNode[];
  members?: ReasoningReplayNode[];
  reasoning?: unknown;
};

export const stripAssistantReasoningForReplay = (messages: UIChatMessage[]): UIChatMessage[] => {
  const stripMessage = <T extends ReasoningReplayNode>(message: T): T => {
    let changed = false;

    const children = message.children?.map((child) => {
      const strippedChild = stripMessage(child);
      if (strippedChild !== child) changed = true;
      return strippedChild;
    });

    const members = message.members?.map((member) => {
      const strippedMember = stripMessage(member);
      if (strippedMember !== member) changed = true;
      return strippedMember;
    });

    if ('reasoning' in message) changed = true;
    if (!changed) return message;

    const { reasoning: _reasoning, ...messageWithoutReasoning } = message;

    return {
      ...messageWithoutReasoning,
      ...(children ? { children } : {}),
      ...(members ? { members } : {}),
    } as T;
  };

  let changed = false;

  const strippedMessages = messages.map((message) => {
    const strippedMessage = stripMessage(message);
    if (strippedMessage !== message) changed = true;
    return strippedMessage;
  });

  return changed ? strippedMessages : messages;
};

export const GEN_AI_FUNCTION_TOOL_TYPE: ToolType = 'function';

type ToolFailureKind = 'replan' | 'retry' | 'stop';

const getToolFailureKind = (result: ToolExecutionResultResponse): ToolFailureKind | undefined => {
  if (!result.error || typeof result.error !== 'object') return;

  const { kind } = result.error as { kind?: unknown };
  return kind === 'replan' || kind === 'retry' || kind === 'stop' ? kind : undefined;
};

const shouldRetryTool = (kind: ToolFailureKind | undefined, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

export const archiveRuntimeToolResult = async (
  result: ToolExecutionResultResponse,
  {
    agentId,
    identifier,
    limit,
    serverDB,
    toolCallId,
    topicId,
    userId,
    workspaceId,
  }: {
    agentId?: string | null;
    identifier?: string;
    limit?: number;
    serverDB: LobeChatDatabase;
    toolCallId?: string;
    topicId?: string | null;
    userId?: string;
    workspaceId?: string;
  },
): Promise<ToolExecutionResultResponse> => {
  const archive = await archiveToolResultIfNeeded({
    agentId,
    content: result.content,
    identifier,
    limit,
    serverDB,
    toolCallId,
    topicId,
    userId,
    workspaceId,
  });

  return archive.content === result.content ? result : { ...result, content: archive.content };
};

// Builds a postProcessUrl callback that resolves keys in file-backed fields
// (imageList, videoList, fileList) to externally accessible URLs. Must be
// passed to every messageModel.query() call whose output is later fed to the
// LLM — otherwise the provider layer receives raw keys like
// `files/user_xxx/icon.png` and rejects them.
//
// FileService is constructed lazily so environments without S3 config (unit
// tests) don't fail at context-build time; failure returns undefined, which
// leaves URLs as raw keys — same behavior as before this helper existed.
export const buildPostProcessUrl = (
  ctx: Pick<RuntimeExecutorContext, 'serverDB' | 'userId' | 'workspaceId'>,
) => {
  if (!ctx.userId || !ctx.serverDB) return undefined;
  let fileService: FileService | undefined;
  try {
    fileService = new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId);
  } catch {
    return undefined;
  }
  return (path: string | null, file: { id?: string | null }) =>
    fileService!.getFileAccessUrl({ id: file.id, url: path });
};

/**
 * Build the per-tool-call server virtual sub-agent runner injected into the tool
 * execution context. Closes over the current tool payload + parent message so
 * the `callSubAgent` server tool can fork a child op without re-deriving the
 * message anchor (which it cannot do correctly from its own context).
 *
 * The runner creates the pending placeholder tool message that anchors the
 * isolation thread (so the UI shows a loading state and the completion bridge
 * has a message to backfill), then kicks off the child op asynchronously and
 * returns immediately. Returns `undefined` when virtual sub-agent execution is
 * not available (no `execVirtualSubAgent` callback, or missing agent/topic
 * context).
 */
export const buildServerVirtualSubAgentRunner = (
  ctx: RuntimeExecutorContext,
  state: AgentState,
  chatToolPayload: ChatToolPayload,
  parentMessageId: string,
): ServerSubAgentRunner | undefined => {
  const execVirtualSubAgent = ctx.execVirtualSubAgent;
  if (!execVirtualSubAgent) return undefined;

  const agentId = state.metadata?.agentId;
  const topicId = ctx.topicId ?? state.metadata?.topicId;
  if (!agentId || !topicId) return undefined;

  return {
    run: async ({ agentId: targetAgentId, description, instruction, timeout }) => {
      // 1. Create the pending placeholder tool message (mirrors the normal
      //    tool-message shape in call_tool) that anchors the isolation thread
      //    and renders a loading state until the bridge backfills it.
      const placeholder = await ctx.messageModel.create({
        agentId,
        content: '',
        groupId: state.metadata?.groupId ?? undefined,
        parentId: parentMessageId,
        plugin: chatToolPayload as any,
        pluginState: { status: 'pending' },
        role: 'tool',
        threadId: state.metadata?.threadId,
        tool_call_id: chatToolPayload.id,
        topicId,
      });

      // 2. Fork the virtual child op anchored to the placeholder. The virtual
      //    entry marks the child as `isSubAgent` and registers the completion
      //    bridge that backfills this tool message and resumes the parent op.
      const result = (await execVirtualSubAgent({
        agentId: targetAgentId ?? agentId,
        groupId: state.metadata?.groupId ?? undefined,
        instruction,
        parentMessageId: placeholder.id,
        parentOperationId: ctx.operationId,
        timeout,
        title: description,
        topicId,
      })) as
        | { error?: string; operationId?: string; success?: boolean; threadId?: string }
        | undefined;

      // 3. If the child op never started, no completion bridge will fire — parking
      //    the parent on it would hang forever. Drop the placeholder and signal
      //    `started: false` (with the underlying reason) so callSubAgent surfaces
      //    an inline tool error instead.
      if (!result?.success) {
        try {
          await ctx.messageModel.deleteMessage(placeholder.id);
        } catch (error) {
          log(
            'buildServerVirtualSubAgentRunner: failed to clean up placeholder %s: %O',
            placeholder.id,
            error,
          );
        }
        return {
          error: result?.error,
          started: false,
          subOperationId: result?.operationId,
          threadId: '',
        };
      }

      return {
        started: true,
        subOperationId: result?.operationId,
        threadId: result?.threadId ?? '',
      };
    },
  };
};

/**
 * Build the per-tool "call agent member" runner for the group orchestration
 * server tool (`lobe-group-management`). Mirrors {@link buildServerVirtualSubAgentRunner}
 * but for group members: it owns the group tool message (the parked tool call)
 * and the per-member anchors that drive the K=N member barrier.
 *
 * For each `agentMember.run(...)` it:
 *   1. creates the group tool placeholder (`tool_call_id` = the group-management
 *      call id) stamped with the barrier target + finish disposition;
 *   2. for a single member uses that placeholder as the member anchor; for
 *      multiple members creates one child anchor per member under it;
 *   3. forks each member via `ctx.execGroupMember` (in-group or isolated);
 *   4. backfills anchors for members that failed to start so the barrier can
 *      still complete, and tears everything down when none started.
 *
 * Returns `undefined` when group-member execution is unavailable (no
 * `execGroupMember` callback, or missing agent/topic/group context).
 */
export const buildServerAgentMemberRunner = (
  ctx: RuntimeExecutorContext,
  state: AgentState,
  chatToolPayload: ChatToolPayload,
  parentMessageId: string,
): ServerAgentMemberRunner | undefined => {
  const execGroupMember = ctx.execGroupMember;
  if (!execGroupMember) return undefined;

  const agentId = state.metadata?.agentId;
  const topicId = ctx.topicId ?? state.metadata?.topicId;
  const groupId = state.metadata?.groupId ?? undefined;
  if (!agentId || !topicId || !groupId) return undefined;

  return {
    run: async ({ members, mode, onComplete, disableTools, timeout }) => {
      const expectedMembers = members.length;
      if (expectedMembers === 0) return { started: false, startedCount: 0 };

      // In-group multi-member actions (broadcast) render as an AgentCouncil: each
      // member speaks DIRECTLY under the group tool message and the UI groups them
      // into one parallel-streaming block. This mirrors the client broadcast tree
      // (`metadata.agentCouncil` + member messages parented to the tool message),
      // so it reuses the same conversation-flow council path. No per-member receipt
      // anchors — the member barrier counts completed member messages instead.
      const isCouncil = mode === 'in_group' && expectedMembers > 1;

      // 1. Group tool placeholder — the parked tool call the supervisor op waits
      //    on. Stamped with the barrier target + finish disposition so the resume
      //    path (and verify watchdog) resolve resume-vs-finish on their own.
      const groupTool = await ctx.messageModel.create({
        agentId,
        content: '',
        groupId,
        ...(isCouncil ? { metadata: { agentCouncil: true } } : {}),
        parentId: parentMessageId,
        plugin: chatToolPayload as any,
        pluginState: { expectedMembers, onComplete, status: 'pending' },
        role: 'tool',
        threadId: state.metadata?.threadId,
        tool_call_id: chatToolPayload.id,
        topicId,
      });

      // 2. Per-member anchors. A single member collapses onto the group tool
      //    message; multiple members each get a child anchor under it. These
      //    anchors drive the K=N completion barrier; for councils the member
      //    responses themselves attach to the group tool message (see
      //    execAgentMember), so the UI groups them while the anchors stay
      //    barrier-only and are filtered out of the council member set.
      const anchorIds: string[] = [];
      if (expectedMembers === 1) {
        anchorIds.push(groupTool.id);
      } else {
        for (let i = 0; i < expectedMembers; i += 1) {
          const memberToolCallId = `${chatToolPayload.id}::m${i}`;
          const anchor = await ctx.messageModel.create({
            agentId,
            content: '',
            groupId,
            parentId: groupTool.id,
            plugin: { ...(chatToolPayload as any), id: memberToolCallId },
            pluginState: { status: 'pending' },
            role: 'tool',
            threadId: state.metadata?.threadId,
            tool_call_id: memberToolCallId,
            topicId,
          });
          anchorIds.push(anchor.id);
        }
      }

      // 3. Fork members.
      let startedCount = 0;
      await Promise.all(
        members.map(async (member, i) => {
          const anchorMessageId = anchorIds[i];
          try {
            const result = await execGroupMember({
              agentId: member.agentId,
              anchorMessageId,
              disableTools,
              expectedMembers,
              groupId,
              groupToolMessageId: groupTool.id,
              instruction: member.instruction,
              mode,
              onComplete,
              parentOperationId: ctx.operationId,
              // The supervisor assistant message owning this tool call — council
              // members parent their response here (siblings of the council tool).
              supervisorMessageId: parentMessageId,
              timeout,
              topicId,
            });
            if (result?.started) {
              startedCount += 1;
              return;
            }
          } catch (error) {
            log(
              'buildServerAgentMemberRunner: member %s failed to start: %O',
              member.agentId,
              error,
            );
          }
          // Member failed to start — its completion bridge will never fire, so
          // backfill the anchor as errored to keep the K=N barrier reachable.
          try {
            await ctx.messageModel.updateToolMessage(anchorMessageId, {
              content: `Agent member "${member.agentId}" failed to start.`,
              pluginState: { status: 'error' },
            });
          } catch (error) {
            log(
              'buildServerAgentMemberRunner: failed to mark anchor %s as errored: %O',
              anchorMessageId,
              error,
            );
          }
        }),
      );

      // None started — no bridge will ever fire, so tear down the placeholders
      // and let the caller surface an inline tool error instead of parking.
      if (startedCount === 0) {
        for (const id of new Set([...anchorIds, groupTool.id])) {
          try {
            await ctx.messageModel.deleteMessage(id);
          } catch (error) {
            log('buildServerAgentMemberRunner: cleanup failed for %s: %O', id, error);
          }
        }
        return { started: false, startedCount: 0 };
      }

      return { started: true, startedCount };
    },
  };
};

export const shouldRetryLLM = (kind: LLMErrorKind, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

const resolveLLMMaxRetries = (provider: string) =>
  // The branded provider already routes through its own fallback chain. Retrying
  // again here multiplies the same failed routed request across every channel.
  provider === BRANDING_PROVIDER ? 0 : LLM_MAX_RETRIES;

/**
 * Retry budget for a *specific* failed attempt. This is provider policy +
 * error-type override, so it can only be resolved once the error exists (in the
 * catch) — unlike {@link resolveLLMMaxRetries}, which runs before the request.
 *
 * Empty completions bypass the per-provider policy: the branded
 * provider's 0-retry rule exists to avoid re-routing its own already-failed
 * requests, but an HTTP-200-but-empty turn never hit that fallback chain, so it
 * must still be re-issued. Folding this into `resolveLLMMaxRetries` would wrongly
 * grant the floor to *every* branded error.
 */
export const resolveLLMRetryBudget = (provider: string, error: unknown) =>
  error instanceof ModelEmptyError ? EMPTY_COMPLETION_MAX_RETRIES : resolveLLMMaxRetries(provider);

/** Loop bound — must accommodate the largest budget any error kind can request. */
export const resolveLLMMaxAttempts = (provider: string) =>
  Math.max(resolveLLMMaxRetries(provider), EMPTY_COMPLETION_MAX_RETRIES) + 1;

export const resolveRuntimeHistoryCount = (historyCount?: number) => {
  if (historyCount === undefined) return undefined;

  // Agent config stores historical message count, excluding the current turn.
  // Runtime executors already pass the current user/tool turn in `llmPayload.messages`;
  // without this +1, `historyCount: 0` truncates the current message too and sends
  // `messages: []` to providers.
  return historyCount + 1;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getLLMRetryDelayMs = (attempt: number) =>
  Math.min(LLM_RETRY_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), LLM_RETRY_MAX_DELAY_MS);

export const isOperationInterrupted = async (ctx: RuntimeExecutorContext) => {
  if (!ctx.loadAgentState) return false;

  try {
    const latestState = await ctx.loadAgentState(ctx.operationId);
    return latestState?.status === 'interrupted';
  } catch (error) {
    console.error('[RuntimeExecutors] Failed to load operation state for retry guard:', error);
    return false;
  }
};

export const executeToolWithRetry = async (
  execute: () => Promise<ToolExecutionResultResponse>,
  params: {
    isInterrupted?: () => Promise<boolean>;
    maxRetries: number;
    operationLogId: string;
    toolName: string;
  },
): Promise<{ attempts: number; result: ToolExecutionResultResponse }> => {
  const maxAttempts = params.maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await execute();

    if (result.success) return { attempts: attempt, result };

    const kind = getToolFailureKind(result);

    if (shouldRetryTool(kind, attempt, params.maxRetries)) {
      if (await params.isInterrupted?.()) {
        return { attempts: attempt, result };
      }

      log(
        '[%s] Tool %s failed with kind=%s (attempt %d/%d), retrying ...',
        params.operationLogId,
        params.toolName,
        kind,
        attempt,
        maxAttempts,
      );
      continue;
    }

    return { attempts: attempt, result };
  }

  throw new Error('Tool execution retry loop exited unexpectedly');
};

export const buildToolDiscoveryConfig = (
  operationToolSet: OperationToolSet,
  enabledToolIds: string[],
) => {
  const enabledToolSet = new Set(enabledToolIds);

  if (!enabledToolSet.has(LobeActivatorIdentifier)) return undefined;

  const availableTools = Object.entries(operationToolSet.manifestMap)
    .filter(([identifier]) => !enabledToolSet.has(identifier))
    .map(([identifier, manifest]) => ({
      description: manifest.meta?.description || '',
      identifier,
      name: manifest.meta?.title || identifier,
    }));

  if (availableTools.length === 0) return undefined;

  return { availableTools };
};
