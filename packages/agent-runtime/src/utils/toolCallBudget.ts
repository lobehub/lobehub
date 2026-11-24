import type { ChatToolPayload } from '@lobechat/types';

import type { AgentState } from '../types';

/**
 * Calls one operation may make to any single lookup API below. The repeat guard
 * cannot see a model that rephrases its query every turn, because each call has
 * a new signature: one reply ran `searchUserMemory` 500 times with 500 different
 * arguments and spent 13.7M input tokens before it hit the context window.
 *
 * Generous for real research, which rarely needs this many searches of one kind
 * in a single reply. Reaching it does not fail the run: the calls already made
 * return to the model, which then answers with tools removed.
 */
export const TOOL_CALL_BUDGET_PER_OPERATION = 50;

/**
 * Read-only lookups a model can retry forever by rewording the query. Deliberately
 * an allowlist: file, shell, browser and MCP tools legitimately run hundreds of
 * times in a long task, and MCP job-status polling must not be cut off, so those
 * stay under the repeat and burst guards only.
 */
const BUDGETED_LOOKUP_APIS: Readonly<Record<string, readonly string[]>> = {
  'lobe-agent-builder': ['searchMarketTools'],
  'lobe-agent-management': ['searchAgent', 'searchMarketTools'],
  'lobe-group-agent-builder': ['searchAgent', 'searchMarketTools'],
  'lobe-knowledge-base': ['searchKnowledgeBase'],
  'lobe-message': ['searchMessages'],
  'lobe-skill-store': ['searchSkill'],
  'lobe-user-memory': ['queryTaxonomyOptions', 'searchUserMemory'],
  'lobe-web-browsing': ['search'],
};

export const isBudgetedToolCall = ({
  apiName,
  identifier,
}: Pick<ChatToolPayload, 'apiName' | 'identifier'>) =>
  BUDGETED_LOOKUP_APIS[identifier]?.includes(apiName) ?? false;

export interface ToolCallBudgetDecision {
  /** Calls that may be dispatched this turn. */
  allowed: ChatToolPayload[];
  /** Calls withheld because the budget is spent. */
  blocked: ChatToolPayload[];
  budget: NonNullable<AgentState['toolCallBudget']>;
}

/**
 * Charge this turn's calls against the operation budget. A turn that crosses the
 * limit keeps the calls that still fit. Once the budget is spent nothing else is
 * dispatched, including tools outside the budget, so a model that ignores the
 * removed tools cannot keep the run alive.
 */
export const applyToolCallBudget = (
  previous: AgentState['toolCallBudget'],
  toolsCalling: ChatToolPayload[],
): ToolCallBudgetDecision => {
  if (previous?.stoppedByBudget) {
    return { allowed: [], blocked: toolsCalling, budget: previous };
  }

  const counts = { ...previous?.counts };
  const allowed: ChatToolPayload[] = [];
  const blocked: ChatToolPayload[] = [];

  for (const toolCalling of toolsCalling) {
    if (!isBudgetedToolCall(toolCalling)) {
      allowed.push(toolCalling);
      continue;
    }

    const key = `${toolCalling.identifier}/${toolCalling.apiName}`;
    const used = counts[key] ?? 0;
    if (used >= TOOL_CALL_BUDGET_PER_OPERATION) {
      blocked.push(toolCalling);
      continue;
    }

    counts[key] = used + 1;
    allowed.push(toolCalling);
  }

  const exhaustedTool = Object.keys(counts).find(
    (key) => counts[key] >= TOOL_CALL_BUDGET_PER_OPERATION,
  );

  return {
    allowed,
    blocked,
    budget: { counts, ...(exhaustedTool && { exhaustedTool, stoppedByBudget: true }) },
  };
};

export const toolCallBudgetStopNote = (exhaustedTool?: string) =>
  `Stopped after ${exhaustedTool ?? 'a lookup tool'} reached its limit of ${TOOL_CALL_BUDGET_PER_OPERATION} calls in this run.`;
