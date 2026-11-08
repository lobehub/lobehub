import { expect, it } from 'vitest';

import {
  mcpInvocationKey,
  mcpOriginalCallId,
  mcpTransportCallId,
  mcpTransportContext,
} from './transport';

const base = {
  userId: 'alice',
  operationId: 'op:1',
  assistantMessageId: 'assistant-1',
  toolCallId: 'call:1/☃',
};
it('binds every scope dimension while preserving the original provider id', () => {
  const one = mcpTransportCallId(base);
  for (const patch of [
    { userId: 'bob' },
    { workspaceId: 'ws' },
    { operationId: 'other' },
    { assistantMessageId: 'assistant-2' },
    { toolCallId: 'other' },
  ])
    expect(mcpTransportCallId({ ...base, ...patch })).not.toBe(one);
  expect(mcpOriginalCallId(base.operationId, one)).toBe(base.toolCallId);
  expect(mcpTransportContext(base.operationId, one, base)).toMatchObject({
    ...base,
    workspaceId: undefined,
    completeIdentity: true,
  });
  expect(() => mcpTransportContext(base.operationId, one, { userId: 'bob' })).toThrow(
    'identity mismatch',
  );
  expect(() => mcpTransportContext(base.operationId, one, { assistantMessageId: 'other' })).toThrow(
    'identity mismatch',
  );
  expect(() => mcpOriginalCallId('wrong-op', one)).toThrow('identity mismatch');
  expect(() => mcpInvocationKey({ ...base, assistantMessageId: '' })).toThrow('Incomplete');
});
it('decodes pre-upgrade messages without treating them as complete identities', () => {
  expect(mcpTransportContext('op', 'mcp-invocation:op:call:workspace')).toMatchObject({
    toolCallId: 'call',
    workspaceId: 'workspace',
    completeIdentity: false,
  });
  expect(mcpOriginalCallId('legacy-op', 'legacy-call')).toBe('legacy-call');
  expect(() => mcpOriginalCallId('wrong', 'mcp-invocation:op:call')).toThrow('identity mismatch');
});
