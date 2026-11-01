import { describe, expect, it } from 'vitest';

import { validateE2EEnvironment } from './e2eEnvironment';

const selectedEnvironment = {
  LOBEHUB_CLI_HOME: '.lobehub-e2e',
  LOBEHUB_E2E_ALLOW_WRITES: '1',
  LOBEHUB_SERVER: 'http://localhost:3010',
};

describe('live E2E environment', () => {
  it('requires explicit write authorization', () => {
    expect(() =>
      validateE2EEnvironment({ ...selectedEnvironment, LOBEHUB_E2E_ALLOW_WRITES: undefined }),
    ).toThrow('ALLOW_WRITES');
  });

  it.each([undefined, '', '.lobehub', '/tmp/../home/.lobehub/'])(
    'rejects an absent or default home: %s',
    (home) => {
      expect(() =>
        validateE2EEnvironment({ ...selectedEnvironment, LOBEHUB_CLI_HOME: home }),
      ).toThrow('dedicated');
    },
  );

  it.each([undefined, 'file:///tmp/server', 'https://user:secret@example.test'])(
    'rejects a missing or unsafe server: %s',
    (server) => {
      expect(() =>
        validateE2EEnvironment({ ...selectedEnvironment, LOBEHUB_SERVER: server }),
      ).toThrow();
    },
  );

  it('preserves the selected home and environment', () => {
    const env = Object.freeze({ ...selectedEnvironment });
    expect(() => validateE2EEnvironment(env)).not.toThrow();
    expect(env).toEqual(selectedEnvironment);
  });
});
