import type {
  ToolCallHookEvent,
  ToolForwardingRequest,
  ToolRunResult,
} from '@lobechat/agent-runtime';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { type EvalToolForwardingConfig } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { type AgentHook } from '../hooks';
import { EVAL_TOOL_FORWARDING_HOOK_ID } from './constants';

export const toToolForwardingFailure = (error?: unknown): ToolRunResult => ({
  content: error === undefined ? 'Tool forwarding failed' : String(error),
  error,
  success: false,
});

export const createEvalToolForwardingHook = (
  toolForwarding: EvalToolForwardingConfig,
  caseId?: string,
): AgentHook => ({
  handler: async (event) => {
    const { apiName, args, callIndex, identifier, mock, operationId, stepIndex } =
      event as unknown as ToolCallHookEvent;
    const target = toolForwarding[identifier];
    if (!target) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), target.timeoutMs ?? 15_000);

    try {
      const payload: ToolForwardingRequest = {
        data: { apiName, args, identifier },
        metadata: { ...(caseId && { caseId }), callIndex, operationId, stepIndex },
        type: 'toolCall',
      };
      const response = await ssrfSafeFetch(target.endpoint, {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) throw `Tool forwarding server responded with HTTP ${response.status}`;

      const body: unknown = await response.json();
      if (!isRecord(body)) throw new Error('Invalid tool forwarding response');

      if (body.success === true) {
        const result = body.data;
        if (
          isRecord(result) &&
          typeof result.content === 'string' &&
          typeof result.success === 'boolean'
        ) {
          mock({ ...result, content: result.content, success: result.success });
        } else {
          mock({ content: 'No tool result', success: true });
        }
      } else {
        mock(toToolForwardingFailure(body.error));
      }
    } catch (error) {
      mock(toToolForwardingFailure(error));
    } finally {
      clearTimeout(timeout);
    }
  },
  id: EVAL_TOOL_FORWARDING_HOOK_ID,
  type: 'beforeToolCall',
});
