import type {
  ToolCallHookEvent,
  ToolForwardingRequest,
  ToolRunResult,
} from '@lobechat/agent-runtime';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { type EvalToolForwardingConfig } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { isTrustedMockEndpoint } from '@/server/services/agentEvalRun/mockService';

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
  attemptId?: string,
): AgentHook => ({
  handler: async (event) => {
    const { apiName, args, callIndex, identifier, mock, operationId, stepIndex } =
      event as unknown as ToolCallHookEvent;
    const target = toolForwarding[identifier];
    if (!target) return;

    // The shared secret below may only ever reach the deployment's mock
    // (EVAL_TOOL_MOCK_BASE_URL). A table entry pointing anywhere else, whether
    // stored with an old case or injected, is refused before any request.
    if (!isTrustedMockEndpoint(target.endpoint)) {
      mock(
        toToolForwardingFailure(
          'Tool forwarding refused: the target is not the trusted mock tool service of this server',
        ),
      );
      return;
    }
    const endpoint = target.endpoint!;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), target.timeoutMs ?? 15_000);

    try {
      const payload: ToolForwardingRequest = {
        data: { apiName, args, identifier },
        metadata: {
          ...(attemptId && { attemptId }),
          ...(caseId && { caseId }),
          callIndex,
          operationId,
          stepIndex,
        },
        type: 'toolCall',
      };
      // The mock service is reachable from the internet once deployed; a shared
      // secret (server env, never case content) is what tells it this call came
      // from this server and not from anyone who knows the URL.
      const token = process.env.EVAL_TOOL_FORWARDING_TOKEN;
      const response = await ssrfSafeFetch(endpoint, {
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        method: 'POST',
        // Never follow a redirect: it would carry the token to wherever the
        // response points, outside the destination that was just verified.
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok) {
        // Release the unread error body, including redirects, immediately.
        await response.body?.cancel().catch(() => {});
        if (response.status >= 300 && response.status < 400) {
          throw `Tool forwarding server redirected (HTTP ${response.status}); redirects are not followed`;
        }
        throw `Tool forwarding server responded with HTTP ${response.status}`;
      }

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
