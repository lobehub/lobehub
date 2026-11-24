import type { ChatToolPayload } from '@lobechat/types';

import type { AgentState } from '../types';
import { selectEffectiveToolManifestMap } from './operationToolSet';

/**
 * Consecutive identical calls allowed before the turn is stopped. High enough
 * that legitimate fixed-argument polling loops (e.g. an MCP job-status check
 * repeated until the job finishes) don't get cut off, while a model stuck
 * replaying the same call forever is still caught.
 */
export const TOOL_CALL_REPEAT_LIMIT = 20;

/**
 * Tool calls one LLM turn may request before the turn is stopped without
 * running any of them. A model that has lost the thread can fill its whole
 * output budget with tool calls (MiMo V2.6 Flash emitted 4,383 in one turn,
 * 131k tokens, mostly varied arguments); every one of those would otherwise
 * be dispatched to a real service. Legitimate fan-out stays far below this.
 */
export const TOOL_CALL_BURST_LIMIT = 50;

/**
 * Consecutive LLM turns that may ask for an API past its
 * `maxCallsPerOperation` budget, each answered with a rejected tool result,
 * before the run is stopped. The rejection exists so the model can answer with
 * what it already retrieved; one that keeps asking turn after turn is stuck.
 */
export const TOOL_CALL_BUDGET_FEEDBACK_LIMIT = 2;
export const TOOL_CALL_BUDGET_REASON = 'tool_call_budget_exceeded';

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
    // Copies of one call inside a single turn count like consecutive turns:
    // a model that asks for the same call hundreds of times in one response is
    // as stuck as one that asks once per turn, and counting per turn let the
    // whole batch through to the tools.
    counts[signature] = (counts[signature] ?? previousCounts[signature] ?? 0) + 1;
  }

  return { counts };
};

export const hasRepeatedToolCall = (guard: AgentState['toolCallRepeatGuard']) =>
  Object.values(guard?.counts ?? {}).some((count) => count >= TOOL_CALL_REPEAT_LIMIT);

export const hasToolCallBurst = (toolsCalling: ChatToolPayload[]) =>
  toolsCalling.length > TOOL_CALL_BURST_LIMIT;

const getApiKey = ({ apiName, identifier }: ChatToolPayload) =>
  JSON.stringify([identifier, apiName]);

/**
 * The API's `maxCallsPerOperation`, read from the same effective manifest map
 * executors use so a step-activated tool is budgeted like a static one.
 */
export const getToolCallBudget = (
  toolCalling: ChatToolPayload,
  state: AgentState,
): number | undefined => {
  const apis = selectEffectiveToolManifestMap(state)[toolCalling.identifier]?.api as
    Array<{ maxCallsPerOperation?: number; name?: string }> | undefined;
  const limit = apis?.find((api) => api.name === toolCalling.apiName)?.maxCallsPerOperation;

  return typeof limit === 'number' && limit > 0 ? limit : undefined;
};

/**
 * What the model reads back for a call past the budget. It has to name the way
 * out: a bare "rejected" reads like a transient failure and invites a retry.
 */
export const buildToolCallBudgetContent = (toolCalling: ChatToolPayload, limit: number) =>
  `Tool call rejected: ${toolCalling.apiName} has reached its limit of ${limit} calls in this reply. The call was not executed, and further calls will be rejected too. Do not call it again: answer now with the results you already have, and say plainly if they do not cover the request.`;

/**
 * Count this turn's calls against each API's operation-wide budget.
 *
 * The repeat guard above keys on arguments, so a model that rephrases its
 * query every turn never trips it (500 `searchUserMemory` calls in one reply,
 * each with a new query). The budget ignores arguments and spans the whole
 * operation, and only applies to APIs that declare one, so file reads, shell
 * commands and job polling keep running as often as the task needs.
 */
export const updateToolCallBudget = (state: AgentState, toolsCalling: ChatToolPayload[]) => {
  const previousGuard = state.toolCallRepeatGuard;
  const apiCalls = { ...previousGuard?.apiCalls };
  const overBudgetCalls: Array<{ limit: number; toolCalling: ChatToolPayload }> = [];

  for (const toolCalling of toolsCalling) {
    const limit = getToolCallBudget(toolCalling, state);
    if (limit === undefined) continue;

    const key = getApiKey(toolCalling);
    apiCalls[key] = (apiCalls[key] ?? 0) + 1;
    if (apiCalls[key] > limit) overBudgetCalls.push({ limit, toolCalling });
  }

  return {
    apiCalls,
    overBudgetCalls,
    // Consecutive turns only: a turn that stays within budget (or calls no
    // tools) means the model took the feedback, so the count starts over.
    overBudgetRounds: overBudgetCalls.length > 0 ? (previousGuard?.overBudgetRounds ?? 0) + 1 : 0,
  };
};

export const hasIgnoredToolCallBudget = (overBudgetRounds: number) =>
  overBudgetRounds > TOOL_CALL_BUDGET_FEEDBACK_LIMIT;
