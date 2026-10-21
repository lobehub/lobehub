import type {
  ToolEndData,
  ToolStartData,
  ToolStateChunkData,
} from '@lobechat/agent-gateway-client';
import type { BuiltinToolResult } from '@lobechat/types';
import { isRecord, pickNonEmptyString } from '@lobechat/utils/object';

// Lazy-loaded to break the import cycle:
//   gateway.ts → gatewayEventHandler.ts → executors/index.ts (which pulls in
//   tool client barrels that import `@/store/chat/store`) → chat store
//   creation → `new GatewayActionImpl(...)` while gateway.ts is still
//   mid-evaluation, so the class binding is undefined.
const loadGetExecutor = async () => {
  const mod = await import('@/store/tool/slices/builtin/executors');
  await mod.registerBuiltinToolExecutors();
  return mod.getExecutor;
};

export const getToolId = (tool: unknown): string | undefined =>
  isRecord(tool) ? pickNonEmptyString(tool.id) : undefined;

const getToolResultMessageId = (tool: unknown): string | undefined =>
  isRecord(tool) ? pickNonEmptyString(tool.result_msg_id) : undefined;

export const isToolStateChunkData = (data: unknown): data is ToolStateChunkData =>
  isRecord(data) &&
  data.chunkType === 'tool_state' &&
  data.snapshotMode === 'replace' &&
  typeof data.toolCallId === 'string' &&
  data.toolCallId.length > 0 &&
  Number.isInteger(data.snapshotSeq) &&
  (data.snapshotSeq as number) > 0 &&
  isRecord(data.pluginState);

export const preserveToolResultMessageIds = (
  toolsCalling: unknown[],
  existingTools: unknown,
): unknown[] => {
  if (!Array.isArray(existingTools)) return toolsCalling;

  const resultMsgIdByToolId = new Map<string, string>();
  for (const tool of existingTools) {
    const toolId = getToolId(tool);
    const resultMsgId = getToolResultMessageId(tool);
    if (toolId && resultMsgId) resultMsgIdByToolId.set(toolId, resultMsgId);
  }

  if (resultMsgIdByToolId.size === 0) return toolsCalling;

  let changed = false;
  const merged = toolsCalling.map((tool) => {
    const toolId = getToolId(tool);
    if (!toolId || getToolResultMessageId(tool)) return tool;

    const resultMsgId = resultMsgIdByToolId.get(toolId);
    if (!resultMsgId || !isRecord(tool)) return tool;

    changed = true;
    return { ...tool, result_msg_id: resultMsgId };
  });

  return changed ? merged : toolsCalling;
};

interface ChatToolPayloadLike {
  apiName?: unknown;
  arguments?: unknown;
  id?: unknown;
  identifier?: unknown;
}

interface ToolPayloadIdentity {
  apiName: string;
  identifier: string;
  params: unknown;
  toolCallId?: string;
}

/**
 * Extract `{ identifier, apiName, params, toolCallId }` from a stream event's
 * tool payload. Returns `undefined` when the payload is malformed so the
 * caller can skip dispatch without throwing.
 */
const readToolPayload = (
  payload: ChatToolPayloadLike | undefined,
): ToolPayloadIdentity | undefined => {
  const identifier = typeof payload?.identifier === 'string' ? payload.identifier : undefined;
  const apiName = typeof payload?.apiName === 'string' ? payload.apiName : undefined;
  if (!identifier || !apiName) return undefined;

  let params: unknown = payload?.arguments;
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params);
    } catch {
      params = {};
    }
  } else if (params == null) {
    params = {};
  }

  const toolCallId = typeof payload?.id === 'string' ? payload.id : undefined;
  return { apiName, identifier, params, toolCallId };
};

/**
 * Route a `tool_start` event to the executor's optional `onBeforeCall` hook so
 * tool packages can react before their own mutations dispatch (e.g.
 * optimistic UI). Fires for both client- and server-runtime tools.
 */
export const dispatchOnBeforeCall = async (
  data: ToolStartData | undefined,
  topicId?: string,
): Promise<void> => {
  const payload = data?.toolCalling as ChatToolPayloadLike | undefined;
  const identity = readToolPayload(payload);
  if (!identity) return;

  const getExecutor = await loadGetExecutor();
  const executor = getExecutor(identity.identifier);
  if (!executor?.onBeforeCall) return;

  await executor.onBeforeCall({ ...identity, topicId });
};

/**
 * Real gateway `tool_end` events ship `data.payload` as the
 * `{ parentMessageId, toolCalling }` wrapper, NOT a flat `ChatToolPayload`
 * (see `apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts` — both the
 * single-tool and batch publish sites). Unwrap defensively, falling back to
 * the flat shape so we tolerate test fixtures / future emission paths that
 * pass the payload directly.
 */
export const unwrapToolPayload = (raw: unknown): ChatToolPayloadLike | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const wrapper = raw as { toolCalling?: unknown };
  if (wrapper.toolCalling && typeof wrapper.toolCalling === 'object') {
    return wrapper.toolCalling as ChatToolPayloadLike;
  }
  return raw as ChatToolPayloadLike;
};

/**
 * Route a `tool_end` event to the executor's optional `onAfterCall` hook so
 * tool packages can react to their own mutations (e.g. invalidate store
 * caches) regardless of whether the tool ran client- or server-side.
 */
export const dispatchOnAfterCall = async (
  data: ToolEndData | undefined,
  topicId?: string,
): Promise<void> => {
  const identity = readToolPayload(unwrapToolPayload(data?.payload));
  if (!identity) return;

  const getExecutor = await loadGetExecutor();
  const executor = getExecutor(identity.identifier);
  if (!executor?.onAfterCall) return;

  const result = (data?.result ?? {}) as BuiltinToolResult;

  await executor.onAfterCall({
    ...identity,
    // Gateway/hetero tool_end events carry the terminal outcome beside
    // `result`, while client-tool results already include `result.success`.
    // Normalize both shapes so hook-only heterogeneous executors do not treat
    // a successful shell command as failed and skip git/worktree side effects.
    result: { ...result, success: result.success ?? data?.isSuccess },
    topicId,
  });
};
