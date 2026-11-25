import { expect, it } from 'vitest';

import { redactRevokedSnapshots } from './index';

it('does not return raw private input after a source is revoked', () => {
  const result = redactRevokedSnapshots(
    {
      a1: {
        invocationId: 'a1',
        sessionKey: 'openai:gpt-4',
        version: 1,
        sourceIds: ['document:private'],
        system: [{ role: 'system', content: 'PRIVATE PROMPT' }],
        changes: [
          {
            key: 'memory',
            sourceIds: [],
            messages: [{ id: 'm1', role: 'user', content: 'PRIVATE MEMORY' }],
          },
        ],
      },
    },
    ['document:private'],
  );
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(result.a1.invalidated).toBe(true);
});
