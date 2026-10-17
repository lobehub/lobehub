import { z } from 'zod';

export const AGENT_HOOK_RESPONSE_MAX_BYTES = 64 * 1024;
/** Consume only explicit flat decisions from successful responses; strip service metadata. */
export const toolCallHookDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('allow') }),
  z.object({ decision: z.literal('deny'), reason: z.string().optional() }),
]);

export type ToolCallHookDecision = z.infer<typeof toolCallHookDecisionSchema>;
export type ToolCallHookParseResult =
  | { decision: ToolCallHookDecision; status: 'success' }
  | { status: 'ignored' }
  | { code: 'invalid_response' | 'response_too_large'; status: 'error' };

/** Pure parser: never executes tools, applies policy, or includes remote text in errors. */
export function parseToolCallHookResponse(body: string): ToolCallHookParseResult {
  if (new TextEncoder().encode(body).byteLength > AGENT_HOOK_RESPONSE_MAX_BYTES) {
    return { code: 'response_too_large', status: 'error' };
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { status: 'ignored' };
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success || !Object.hasOwn(record.data, 'decision')) return { status: 'ignored' };
  const parsed = toolCallHookDecisionSchema.safeParse(value);
  if (!parsed.success) return { code: 'invalid_response', status: 'error' };
  return { decision: parsed.data, status: 'success' };
}

/** C1 must branch on cancelled before applying onError; cancellation never grants permission. */
export type ToolCallHookExecutionResult =
  | ToolCallHookParseResult
  | { status: 'cancelled' }
  | {
      code: 'configuration' | 'http_error' | 'network_error' | 'timeout';
      status: 'error';
    };

export type ToolCallHookErrorPolicyResult = { action: 'continue' | 'block' };

export function resolveToolCallHookErrorPolicy(
  onError: 'continue' | 'block' = 'continue',
): ToolCallHookErrorPolicyResult {
  return { action: onError };
}
