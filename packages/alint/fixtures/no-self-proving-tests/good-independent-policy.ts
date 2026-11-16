import { expect, it } from 'vitest';

// Published protocol: these identifiers are consumed by separately deployed clients.
const protocolKinds = { approval: 'tool_approval', question: 'question' } as const;

it('preserves the published approval wire identifier', () => {
  expect(protocolKinds.approval).toBe('tool_approval');
});
