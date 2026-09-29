import { z } from 'zod';

export const AGENT_HOOK_RESPONSE_MAX_BYTES = 64 * 1024;
export const AGENT_HOOK_CONTEXT_MAX_CHARACTERS = 10_000;

export const toolCallHookDecisionSchema = z
  .strictObject({
    additionalContext: z.string().max(AGENT_HOOK_CONTEXT_MAX_CHARACTERS).optional(),
    hookEventName: z.literal('beforeToolCall'),
    permissionDecision: z.enum(['allow', 'deny']).optional(),
    permissionDecisionReason: z.string().optional(),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.updatedInput === undefined || value.permissionDecision === 'allow', {
    message: 'updatedInput requires permissionDecision:allow',
  });

const responseSchema = z.strictObject({
  hookSpecificOutput: toolCallHookDecisionSchema.optional(),
});

export type ToolCallHookDecision = z.infer<typeof toolCallHookDecisionSchema>;
export type ToolCallHookParseResult =
  | { decision?: ToolCallHookDecision; status: 'success' }
  | { code: 'invalid_response' | 'response_too_large'; status: 'error' };

/** Pure parser: never executes tools, applies policy, or includes remote text in errors. */
export function parseToolCallHookResponse(body: string): ToolCallHookParseResult {
  if (new TextEncoder().encode(body).byteLength > AGENT_HOOK_RESPONSE_MAX_BYTES) {
    return { code: 'response_too_large', status: 'error' };
  }
  if (body.length === 0) return { status: 'success' };
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { code: 'invalid_response', status: 'error' };
  }
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) return { code: 'invalid_response', status: 'error' };
  return { decision: parsed.data.hookSpecificOutput, status: 'success' };
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
