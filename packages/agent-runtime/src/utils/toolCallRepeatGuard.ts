import type { ChatToolPayload } from '@lobechat/types';

import type { AgentState } from '../types';

/**
 * Consecutive identical calls allowed before the turn is stopped. High enough
 * that legitimate fixed-argument polling loops (e.g. an MCP job-status check
 * repeated until the job finishes) don't get cut off, while a model stuck
 * replaying the same call forever is still caught.
 */
export const TOOL_CALL_REPEAT_LIMIT = 20;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
    );
  }

  return value;
};

const normalizeArguments = (argumentsValue: string) => {
  try {
    return JSON.stringify(canonicalize(JSON.parse(argumentsValue)));
  } catch {
    return argumentsValue.trim();
  }
};

const getToolCallSignature = ({
  apiName,
  arguments: argumentsValue,
  identifier,
}: ChatToolPayload) => JSON.stringify([identifier, apiName, normalizeArguments(argumentsValue)]);

export const updateToolCallRepeatGuard = (
  previousGuard: AgentState['toolCallRepeatGuard'],
  toolsCalling: ChatToolPayload[],
) => {
  if (toolsCalling.length === 0) return { counts: {} };

  const previousCounts = previousGuard?.counts ?? {};
  const counts: Record<string, number> = {};

  for (const toolCalling of toolsCalling) {
    const signature = getToolCallSignature(toolCalling);
    counts[signature] = (previousCounts[signature] ?? 0) + 1;
  }

  return { counts };
};

export const hasRepeatedToolCall = (guard: AgentState['toolCallRepeatGuard']) =>
  Object.values(guard?.counts ?? {}).some((count) => count >= TOOL_CALL_REPEAT_LIMIT);
