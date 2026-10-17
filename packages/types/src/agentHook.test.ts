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
const response = (output: Record<string, unknown>) => JSON.stringify(output);

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
  it.each(['beforeToolCall', 'afterToolCall'])('accepts synchronous %s controls', (type) => {
    const hook = { ...control, type };
    expect(serializedAgentHookSchema.parse(hook)).toEqual(hook);
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
    { ...control, type: 'onToolCallError' },
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

describe('flat tool response parser', () => {
  it.each([
    { decision: 'allow' },
    { decision: 'deny' },
    { decision: 'deny', reason: '禁止执行该操作' },
    { decision: 'deny', reason: '' },
  ])('accepts only flat allow/deny: %j', (decision) => {
    expect(parseToolCallHookResponse(response(decision))).toEqual({
      decision,
      status: 'success',
    });
  });
  it.each([
    '',
    '{}',
    ' ',
    '{',
    'null',
    '[]',
    'true',
    '42',
    '"notification"',
    '[{"decision":"deny"}]',
    '{"decision":',
    response({ reason: 'missing decision' }),
    response({ hookSpecificOutput: { permissionDecision: 'deny' } }),
  ])('ignores a notification response without a top-level decision %#', (body) => {
    expect(parseToolCallHookResponse(body)).toEqual({ status: 'ignored' });
  });
  it.each([
    ...[
      { decision: 'block' },
      { decision: 'ask' },
      { decision: 'defer' },
      { decision: null },
      { decision: 1 },
      { decision: 'deny', reason: 3 },
      { decision: 'deny', reason: null },
    ].map(response),
  ])('rejects an explicitly invalid decision %#', (body) => {
    expect(parseToolCallHookResponse(body)).toEqual({ code: 'invalid_response', status: 'error' });
  });
  it.each(['allow', 'deny'])(
    'discards service fields from %s without extending control',
    (decision) => {
      const body = {
        decision,
        reason: '禁止执行该操作',
        requestId: 'service-trace',
        version: 2,
        updatedInput: { path: '/replacement' },
        additionalContext: 'must not enter the conversation',
        hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'deny' },
      };
      expect(parseToolCallHookResponse(response(body))).toEqual({
        status: 'success',
        decision: decision === 'allow' ? { decision } : { decision, reason: body.reason },
      });
    },
  );
  it('counts response UTF-8 bytes at the exact response boundary', () => {
    const body = response({ decision: 'allow' });
    expect(parseToolCallHookResponse(body + ' '.repeat(65_536 - body.length))).toEqual({
      decision: { decision: 'allow' },
      status: 'success',
    });
    expect(parseToolCallHookResponse(body + ' '.repeat(65_537 - body.length))).toEqual({
      status: 'error',
      code: 'response_too_large',
    });
    expect(
      parseToolCallHookResponse(response({ decision: 'deny', reason: '界'.repeat(22_000) })),
    ).toEqual({ status: 'error', code: 'response_too_large' });
  });
  it('defaults errors to continue and supports explicit block', () => {
    expect(resolveToolCallHookErrorPolicy()).toEqual({ action: 'continue' });
    expect(resolveToolCallHookErrorPolicy('block')).toEqual({ action: 'block' });
  });
});
