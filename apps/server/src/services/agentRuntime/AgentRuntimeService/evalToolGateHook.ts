import type { ToolCallHookEvent } from '@lobechat/agent-runtime';

import { type AgentHook } from '../hooks';
import { EVAL_TOOL_GATE_HOOK_ID } from './constants';

/** What the model reads when it calls a tool the case did not give it (the eval harness's wording). */
export const EVAL_TOOL_BLOCKED_ERROR = 'external_tool_blocked_by_eval';

/**
 * Dispatch-time half of the eval tool gate: a call to an identifier outside
 * the attempt's allowlist never executes and never leaves the sandbox; the
 * model gets the same refusal the eval harness gave. The operation's tool set
 * is already pruned to the allowlist (`applyEvalGateToToolSet`), so this only
 * catches what slips past assembly: a name recalled from history, a guess, or
 * a tool re-activated from an earlier turn.
 */
export const createEvalToolGateHook = (allowedTools: readonly string[]): AgentHook => {
  const allowed = new Set(allowedTools);
  return {
    handler: async (event) => {
      const { apiName, identifier, mock } = event as unknown as ToolCallHookEvent;
      if (allowed.has(identifier)) return;
      mock({
        content: JSON.stringify({
          error: EVAL_TOOL_BLOCKED_ERROR,
          message: `${identifier} is not part of this case's environment.`,
          requested: `${identifier}/${apiName}`,
        }),
        success: false,
      });
    },
    id: EVAL_TOOL_GATE_HOOK_ID,
    type: 'beforeToolCall',
  };
};
