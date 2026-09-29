import { describe, expect, it } from 'vitest';

import {
  agentHookTypeSchema,
  agentHookWebhookSchema,
  serializedAgentHookSchema,
} from './agentHook';
import { parseToolCallHookResponse, resolveToolCallHookErrorPolicy } from './agentHookResponse';

const control = {
  id: 'policy',
  type: 'beforeToolCall',
  webhook: { responseHandling: 'toolCall', url: 'https://example.com' },
};
const response = (output: Record<string, unknown>) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'beforeToolCall', ...output } });

describe('serialized hook contract', () => {
  it('round trips all fields including legacy fallback without expanding secrets', () => {
    const hook = {
      ...control,
      matcher: '^fs/read.*',
      webhook: {
        ...control.webhook,
        allowedEnvVars: ['HOOK_KEY'],
        headers: { Authorization: 'Bearer ${HOOK_KEY}' },
        timeout: 2,
        onError: 'block',
        fallback: 'none',
        delivery: 'fetch',
      },
    };
    const persisted = JSON.stringify(hook);
    expect(serializedAgentHookSchema.parse(JSON.parse(persisted))).toEqual(hook);
  });
  it('accepts every legacy hook and notification body/selection', () => {
    for (const type of agentHookTypeSchema.options) {
      expect(
        serializedAgentHookSchema.safeParse({
          id: type,
          type,
          webhook: {
            url: '/api/hook',
            body: { custom: true },
            eventFields: ['operationId'],
            fallback: 'none',
          },
        }).success,
      ).toBe(true);
    }
  });
  it.each([
    { ...control, type: 'afterToolCall' },
    { ...control, type: 'unknown' },
    { ...control, matcher: '[' },
    { ...control, matcher: { identifier: '^fs$', apiName: '^read' } },
    ...[
      { delivery: 'qstash' },
      { eventFields: [] },
      { body: {} },
      { timeout: 0 },
      { timeout: -1 },
      { timeout: Infinity },
      { timeout: 2_147_484 },
      { url: 'file:///etc/passwd' },
      { url: '//evil.example/path' },
      { url: 'https://name:password@example.com' },
      { surprise: true },
    ].map((webhook) => ({ ...control, webhook: { ...control.webhook, ...webhook } })),
  ])('rejects invalid persisted configuration %#', (hook) => {
    expect(serializedAgentHookSchema.safeParse(hook).success).toBe(false);
  });
  it.each(['', '*', '^fs/readFile$'])(
    'round trips a string matcher %j on every tool event',
    (matcher) => {
      for (const type of ['beforeToolCall', 'afterToolCall', 'onToolCallError']) {
        const hook = { id: 'tool', matcher, type, webhook: { url: '/hook' } };
        expect(serializedAgentHookSchema.parse(hook)).toEqual(hook);
      }
    },
  );
  it.each(['', '*', '^fs/readFile$'])('rejects a matcher %j on every non-tool event', (matcher) => {
    for (const type of agentHookTypeSchema.options.filter(
      (name) => !['beforeToolCall', 'afterToolCall', 'onToolCallError'].includes(name),
    )) {
      expect(
        serializedAgentHookSchema.safeParse({
          id: 'notification',
          matcher,
          type,
          webhook: { url: '/hook' },
        }).success,
      ).toBe(false);
    }
  });
  it('disallows blocking notification errors', () => {
    expect(agentHookWebhookSchema.safeParse({ url: '/hook', onError: 'block' }).success).toBe(
      false,
    );
  });
});

describe('strict tool response parser', () => {
  it.each(['', '{}'])('accepts an empty response or no decision: %s', (body) => {
    expect(parseToolCallHookResponse(body)).toMatchObject({ status: 'success' });
  });
  it('returns allow/replacement/context without applying them', () => {
    const decision = {
      additionalContext: 'untrusted tool context',
      permissionDecision: 'allow',
      updatedInput: { path: '/new' },
    };
    expect(parseToolCallHookResponse(response(decision))).toEqual({
      decision: { hookEventName: 'beforeToolCall', ...decision },
      status: 'success',
    });
    expect(
      parseToolCallHookResponse(
        response({ permissionDecision: 'deny', permissionDecisionReason: 'private' }),
      ),
    ).toMatchObject({ status: 'success', decision: { permissionDecision: 'deny' } });
  });
  it.each([
    ' ',
    '{',
    'null',
    '[]',
    'true',
    '{"continue":false}',
    '{"decision":"block"}',
    '{"stopReason":"stop"}',
    '{"hookSpecificOutput":null}',
    ...[
      { hookEventName: 'afterToolCall' },
      { permissionDecision: 'ask' },
      { permissionDecision: 'defer' },
      { updatedInput: {} },
      { updatedInput: {}, permissionDecision: 'deny' },
      { updatedInput: [], permissionDecision: 'allow' },
      { additionalContext: 1 },
      { additionalContext: 'x'.repeat(10_001) },
      { updatedOutput: {} },
      { permissionDecisionReason: 3 },
    ].map(response),
  ])('rejects malformed or unsupported control response %#', (body) => {
    expect(parseToolCallHookResponse(body)).toEqual({ code: 'invalid_response', status: 'error' });
  });
  it('counts response UTF-8 bytes and enforces exact context boundary', () => {
    expect(parseToolCallHookResponse('{}' + ' '.repeat(65_534))).toMatchObject({
      status: 'success',
    });
    expect(parseToolCallHookResponse('{}' + ' '.repeat(65_535))).toEqual({
      status: 'error',
      code: 'response_too_large',
    });
    expect(
      parseToolCallHookResponse(response({ permissionDecisionReason: '界'.repeat(22_000) })),
    ).toEqual({ status: 'error', code: 'response_too_large' });
    expect(
      parseToolCallHookResponse(response({ additionalContext: 'x'.repeat(10_000) })),
    ).toMatchObject({ status: 'success' });
  });
  it('defaults errors to continue and supports explicit block', () => {
    expect(resolveToolCallHookErrorPolicy()).toEqual({ action: 'continue' });
    expect(resolveToolCallHookErrorPolicy('block')).toEqual({ action: 'block' });
  });
});
