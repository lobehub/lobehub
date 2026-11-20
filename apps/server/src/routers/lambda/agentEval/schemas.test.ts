import { describe, expect, it } from 'vitest';

import { evalCaseEnvironmentSchema } from './schemas';

describe('evalCaseEnvironmentSchema.timezone', () => {
  it.each(['UTC', 'America/Chicago', 'Asia/Shanghai'])(
    'accepts supported timezone %s',
    (timezone) => {
      expect(evalCaseEnvironmentSchema.parse({ timezone })).toEqual({ timezone });
    },
  );

  it('rejects an invalid timezone before a case or shared environment can be saved', () => {
    const result = evalCaseEnvironmentSchema.safeParse({
      sessionDate: '2026-11-01T12:00:00Z',
      timezone: 'Not/AZone',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['timezone']);
  });
});

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
