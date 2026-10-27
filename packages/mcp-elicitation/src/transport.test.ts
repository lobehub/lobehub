import { expect, it } from 'vitest';

import { mcpOriginalCallId, mcpTransportCallId, mcpTransportContext } from './transport';

it('isolates reused provider IDs across operations and faithfully restores the original ID', () => {
  const one = mcpTransportCallId('alice:op', 'call:1/☃');
  const two = mcpTransportCallId('bob:op', 'call:1/☃');
  expect(one).not.toBe(two);
  expect(mcpOriginalCallId('alice:op', one)).toBe('call:1/☃');
  expect(() => mcpOriginalCallId('bob:op', one)).toThrow('identity mismatch');
  expect(mcpOriginalCallId('legacy-op', 'legacy-call')).toBe('legacy-call');
});

it('pins workspace and personal invocations independently of the active page', () => {
  expect(mcpTransportContext('op', mcpTransportCallId('op', 'call', 'workspace:one'))).toEqual({
    toolCallId: 'call',
    workspaceId: 'workspace:one',
    scoped: true,
  });
  expect(mcpTransportContext('op', mcpTransportCallId('op', 'call'))).toEqual({
    toolCallId: 'call',
    workspaceId: undefined,
    scoped: true,
  });
});
