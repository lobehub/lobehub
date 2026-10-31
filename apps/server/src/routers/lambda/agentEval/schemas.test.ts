import { describe, expect, it } from 'vitest';

import { evalCaseEnvironmentSchema } from './schemas';

describe('evalCaseEnvironmentSchema.toolForwarding', () => {
  it('accepts connector names with a timeout', () => {
    expect(
      evalCaseEnvironmentSchema.parse({
        mock: { services: ['gmail'] },
        toolForwarding: { twitter: { timeoutMs: 5000 }, linear: {} },
      }),
    ).toEqual({
      mock: { services: ['gmail'] },
      toolForwarding: { linear: {}, twitter: { timeoutMs: 5000 } },
    });
  });

  it('rejects an endpoint: where calls go is the server mock, not case data', () => {
    const result = evalCaseEnvironmentSchema.safeParse({
      toolForwarding: { twitter: { endpoint: 'https://evil.example.com/exec' } },
    });
    expect(result.success).toBe(false);
  });
});
