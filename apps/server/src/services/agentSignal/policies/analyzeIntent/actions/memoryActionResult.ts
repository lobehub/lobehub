import type { AgentState } from '@lobechat/agent-runtime';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { LayersEnum } from '@lobechat/types';
import { isRecord, pickTrimmedString } from '@lobechat/utils';

/**
 * Pure, dependency-light helpers that derive the durable outcome of a
 * memory-writer agent run from its terminal {@link AgentState}.
 *
 * Kept free of server-runtime imports (ModelRuntime, AgentService, …) on
 * purpose: both the synchronous memory action runner AND the async completion
 * path import this, and the completion path runs in the lightweight agent-runtime
 * completion lifecycle — it must not drag the heavy memory-runner module (and its
 * env-dependent transitive imports) into its graph.
 */

export interface MemoryActionTarget {
  id?: string;
  memoryId?: string;
  memoryLayer?: LayersEnum;
  summary?: string;
  title: string;
  type: 'memory';
}

export interface MemoryAgentActionResult {
  detail?: string;
  status: 'applied' | 'failed' | 'skipped';
  target?: MemoryActionTarget;
}

const MEMORY_WRITE_API_NAMES = [
  MemoryApiName.addActivityMemory,
  MemoryApiName.addContextMemory,
  MemoryApiName.addExperienceMemory,
  MemoryApiName.addIdentityMemory,
  MemoryApiName.addPreferenceMemory,
  MemoryApiName.removeIdentityMemory,
  MemoryApiName.updateIdentityMemory,
] as const;

const MEMORY_WRITE_TOOL_NAMES = new Set(
  MEMORY_WRITE_API_NAMES.map((apiName) => `${MemoryIdentifier}/${apiName}`),
);

const MEMORY_WRITE_API_NAME_SET = new Set<string>(MEMORY_WRITE_API_NAMES);
const MEMORY_WRITE_TARGET_BY_API_NAME: Record<string, { idKey: string; layer: LayersEnum }> = {
  [MemoryApiName.addActivityMemory]: { idKey: 'activityId', layer: LayersEnum.Activity },
  [MemoryApiName.addContextMemory]: { idKey: 'contextId', layer: LayersEnum.Context },
  [MemoryApiName.addExperienceMemory]: { idKey: 'experienceId', layer: LayersEnum.Experience },
  [MemoryApiName.addIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
  [MemoryApiName.addPreferenceMemory]: { idKey: 'preferenceId', layer: LayersEnum.Preference },
  [MemoryApiName.removeIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
  [MemoryApiName.updateIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
};
const TOOL_NAME_SEPARATOR = '____';

const hasSuccessfulMemoryWrite = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];

  return byTool.some(
    (entry) => MEMORY_WRITE_TOOL_NAMES.has(entry.name) && entry.calls > entry.errors,
  );
};

const hasFailedMemoryWrite = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];

  return byTool.some(
    (entry) =>
      MEMORY_WRITE_TOOL_NAMES.has(entry.name) && entry.calls > 0 && entry.calls === entry.errors,
  );
};

const getString = (value: unknown) => {
  return pickTrimmedString(value);
};

const parseToolArguments = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;

  if (typeof value !== 'string') return;

  try {
    const parsed: unknown = JSON.parse(value);

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return;
  }
};

interface MemoryToolCallSnapshot {
  apiName?: string;
  arguments?: unknown;
  id?: string;
  identifier?: string;
}

const getToolCallsFromMessage = (message: unknown): MemoryToolCallSnapshot[] => {
  if (!isRecord(message)) return [];

  const toolCalls: MemoryToolCallSnapshot[] = [];
  const persistedTools = Array.isArray(message.tools) ? message.tools : [];

  for (const tool of persistedTools) {
    if (!isRecord(tool)) continue;

    toolCalls.push({
      apiName: getString(tool.apiName),
      arguments: tool.arguments,
      id: getString(tool.id),
      identifier: getString(tool.identifier),
    });
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  for (const toolCall of rawToolCalls) {
    if (!isRecord(toolCall)) continue;

    const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
    const name = getString(fn?.name);
    if (!name) continue;

    const [identifier, apiName] = name.split(TOOL_NAME_SEPARATOR);

    toolCalls.push({
      apiName: apiName || name,
      arguments: fn?.arguments,
      id: getString(toolCall.id),
      identifier: apiName ? identifier : undefined,
    });
  }

  return toolCalls;
};

const isMemoryWriteToolCall = (
  toolCall: MemoryToolCallSnapshot,
): toolCall is MemoryToolCallSnapshot & { apiName: string } => {
  if (!toolCall.apiName || !MEMORY_WRITE_API_NAME_SET.has(toolCall.apiName)) return false;

  return !toolCall.identifier || toolCall.identifier === MemoryIdentifier;
};

const getToolMessageCallId = (message: unknown) => {
  if (!isRecord(message)) return;

  const plugin = isRecord(message.plugin) ? message.plugin : undefined;

  return getString(message.tool_call_id) ?? getString(plugin?.id);
};

const getMemoryIdsFromToolMessage = (message: unknown) => {
  if (!isRecord(message)) return;

  const ids: Record<string, string> = {};
  const addId = (key: string, value: unknown) => {
    if (!key.endsWith('Id')) return;

    const id = getString(value);
    if (id) ids[key] = id;
  };

  const pluginState = isRecord(message.pluginState) ? message.pluginState : undefined;
  if (pluginState) {
    for (const [key, value] of Object.entries(pluginState)) {
      addId(key, value);
    }
  }

  const content = getString(message.content);
  if (content) {
    for (const match of content.matchAll(/([A-Za-z]\w*Id):\s*"([^"]+)"/g)) {
      addId(match[1], match[2]);
    }
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
};

const getMemoryToolResultIds = (state: AgentState) => {
  const resultIds = new Map<string, Record<string, string>>();

  for (const message of state.messages ?? []) {
    const callId = getToolMessageCallId(message);
    const ids = getMemoryIdsFromToolMessage(message);

    if (callId && ids) resultIds.set(callId, ids);
  }

  return resultIds;
};

const getNestedString = (payload: Record<string, unknown>, keys: string[]) => {
  let current: unknown = payload;

  for (const key of keys) {
    if (!isRecord(current)) return;

    current = current[key];
  }

  return getString(current);
};

const getToolArgumentString = (args: Record<string, unknown>, key: string) => {
  return getString(args[key]) ?? getNestedString(args, ['set', key]);
};

const createTargetFromToolArguments = (
  args: Record<string, unknown>,
  toolCall: MemoryToolCallSnapshot & { apiName: string },
  resultIds?: Record<string, string>,
): MemoryActionTarget | undefined => {
  const title = getToolArgumentString(args, 'title');
  if (!title) return;

  const targetConfig = MEMORY_WRITE_TARGET_BY_API_NAME[toolCall.apiName];
  const id = targetConfig ? resultIds?.[targetConfig.idKey] : undefined;
  const memoryId = resultIds?.memoryId;
  const summary =
    getToolArgumentString(args, 'summary') ??
    getToolArgumentString(args, 'details') ??
    getNestedString(args, ['withPreference', 'conclusionDirectives']);

  return {
    ...((id ?? memoryId) ? { id: id ?? memoryId } : {}),
    ...(memoryId ? { memoryId } : {}),
    ...(targetConfig ? { memoryLayer: targetConfig.layer } : {}),
    ...(summary ? { summary } : {}),
    title,
    type: 'memory',
  };
};

export const resolveMemoryActionTargetFromState = (
  state: AgentState,
): MemoryActionTarget | undefined => {
  const resultIds = getMemoryToolResultIds(state);

  for (const message of [...(state.messages ?? [])].reverse()) {
    const toolCalls = getToolCallsFromMessage(message).reverse();

    for (const toolCall of toolCalls) {
      if (!isMemoryWriteToolCall(toolCall)) continue;
      if (!toolCall.id) continue;

      const confirmedResultIds = resultIds.get(toolCall.id);
      if (!confirmedResultIds) continue;

      const args = parseToolArguments(toolCall.arguments);
      if (!args) continue;

      const target = createTargetFromToolArguments(args, toolCall, confirmedResultIds);
      if (target) return target;
    }
  }
};

/**
 * Derives the memory-action outcome from a terminal memory-writer agent state.
 *
 * Single source of truth for "did the memory write apply / fail / skip", shared
 * by the synchronous runner and the async completion path (which re-derives the
 * outcome from the run's finalState to project a receipt — the memory builtin
 * tool results are not `kind`-tagged, so the completion extractor synthesizes a
 * `writeMemory` mutation from this result instead).
 */
export const resolveMemoryActionResultFromState = (state: AgentState): MemoryAgentActionResult => {
  if (state.status === 'error') {
    return {
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    };
  }

  if (hasSuccessfulMemoryWrite(state)) {
    const target = resolveMemoryActionTargetFromState(state);

    return {
      ...(target?.summary ? { detail: target.summary } : {}),
      status: 'applied',
      ...(target ? { target } : {}),
    };
  }

  if (hasFailedMemoryWrite(state)) {
    return {
      detail: 'Memory tool call failed during memory action agent execution.',
      status: 'failed',
    };
  }

  return {
    detail: 'Memory action agent did not issue a durable memory write.',
    status: 'skipped',
  };
};
