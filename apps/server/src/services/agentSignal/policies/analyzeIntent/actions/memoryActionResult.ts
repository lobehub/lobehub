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

/** Kind of durable write the memory tool performed; only `create` writes are undoable. */
export type MemoryActionOperation = 'create' | 'remove' | 'update';

export interface MemoryActionTarget {
  /** Layer-specific row id (e.g. `preferenceId`), used to open and undo the memory. */
  id?: string;
  memoryId?: string;
  memoryLayer?: LayersEnum;
  operation?: MemoryActionOperation;
  summary?: string;
  /** The memory's own title. Absent when the write cannot be attributed to a titled tool call. */
  title?: string;
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
const MEMORY_WRITE_TARGET_BY_API_NAME: Record<
  string,
  { idKey: string; layer: LayersEnum; operation: MemoryActionOperation }
> = {
  [MemoryApiName.addActivityMemory]: {
    idKey: 'activityId',
    layer: LayersEnum.Activity,
    operation: 'create',
  },
  [MemoryApiName.addContextMemory]: {
    idKey: 'contextId',
    layer: LayersEnum.Context,
    operation: 'create',
  },
  [MemoryApiName.addExperienceMemory]: {
    idKey: 'experienceId',
    layer: LayersEnum.Experience,
    operation: 'create',
  },
  [MemoryApiName.addIdentityMemory]: {
    idKey: 'identityId',
    layer: LayersEnum.Identity,
    operation: 'create',
  },
  [MemoryApiName.addPreferenceMemory]: {
    idKey: 'preferenceId',
    layer: LayersEnum.Preference,
    operation: 'create',
  },
  [MemoryApiName.removeIdentityMemory]: {
    idKey: 'identityId',
    layer: LayersEnum.Identity,
    operation: 'remove',
  },
  [MemoryApiName.updateIdentityMemory]: {
    idKey: 'identityId',
    layer: LayersEnum.Identity,
    operation: 'update',
  },
};
const TOOL_NAME_SEPARATOR = '____';

const getMemoryWriteApiNameFromToolName = (name: unknown) => {
  const toolName = getString(name);
  if (!toolName) return;

  const slashIndex = toolName.indexOf('/');
  const apiName = slashIndex >= 0 ? toolName.slice(slashIndex + 1) : toolName;

  return MEMORY_WRITE_API_NAME_SET.has(apiName) ? apiName : undefined;
};

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

const getSuccessfulMemoryWriteTargetConfig = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];

  for (const entry of byTool) {
    if (entry.calls <= entry.errors) continue;

    const apiName = getMemoryWriteApiNameFromToolName(entry.name);
    if (!apiName) continue;

    return MEMORY_WRITE_TARGET_BY_API_NAME[apiName];
  }
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

/**
 * Tool payloads on a message, including the flattened `assistantGroup` shape the
 * runtime rebuilds `state.messages` into, where each block under `children`
 * carries its own `tools` (with the result inlined).
 */
const getPersistedTools = (message: Record<string, unknown>): Record<string, unknown>[] => {
  const blocks = Array.isArray(message.children) ? message.children.filter(isRecord) : [];

  return [message, ...blocks].flatMap((item) =>
    Array.isArray(item.tools) ? item.tools.filter(isRecord) : [],
  );
};

const getToolCallsFromMessage = (message: unknown): MemoryToolCallSnapshot[] => {
  if (!isRecord(message)) return [];

  const toolCalls: MemoryToolCallSnapshot[] = [];
  const persistedTools = getPersistedTools(message);

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

    // Flattened groups inline each tool's result next to its call.
    if (!isRecord(message)) continue;
    for (const tool of getPersistedTools(message)) {
      const toolCallId = getString(tool.id);
      const result = isRecord(tool.result) ? tool.result : undefined;
      const inlineIds =
        result &&
        getMemoryIdsFromToolMessage({ content: result.content, pluginState: result.state });

      if (toolCallId && inlineIds) resultIds.set(toolCallId, inlineIds);
    }
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
    ...(targetConfig ? { memoryLayer: targetConfig.layer, operation: targetConfig.operation } : {}),
    ...(summary ? { summary } : {}),
    title,
    type: 'memory',
  };
};

/**
 * Every confirmed memory write in the run, in call order. A writer may save
 * several memories (e.g. a context and a preference) from one piece of feedback;
 * each gets its own receipt.
 */
export const resolveMemoryActionTargetsFromState = (state: AgentState): MemoryActionTarget[] => {
  const resultIds = getMemoryToolResultIds(state);
  const targets: MemoryActionTarget[] = [];

  for (const message of state.messages ?? []) {
    for (const toolCall of getToolCallsFromMessage(message)) {
      if (!isMemoryWriteToolCall(toolCall)) continue;
      if (!toolCall.id) continue;

      const confirmedResultIds = resultIds.get(toolCall.id);
      if (!confirmedResultIds) continue;

      const args = parseToolArguments(toolCall.arguments);
      if (!args) continue;

      const target = createTargetFromToolArguments(args, toolCall, confirmedResultIds);
      if (target) targets.push(target);
    }
  }

  return targets;
};

export const resolveMemoryActionTargetFromState = (
  state: AgentState,
): MemoryActionTarget | undefined => {
  const targets = resolveMemoryActionTargetsFromState(state);
  if (targets.length > 0) return targets.at(-1);

  const targetConfig = getSuccessfulMemoryWriteTargetConfig(state);
  if (!targetConfig) return;

  // No titled tool call to attribute: leave the title out so clients render their localized
  // "Memory saved" fallback instead of a server-side English string.
  return {
    memoryLayer: targetConfig.layer,
    operation: targetConfig.operation,
    type: 'memory',
  };
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
