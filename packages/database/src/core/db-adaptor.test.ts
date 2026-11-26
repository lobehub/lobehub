import { afterEach, describe, expect, it, vi } from 'vitest';

describe('db-adaptor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not initialize the database while importing the lazy accessor', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('KEY_VAULTS_SECRET', '');

    const adaptor = await import('./db-adaptor');

    expect(adaptor.getServerDB).toEqual(expect.any(Function));
    expect(adaptor.serverDB).toEqual(expect.any(Object));
  }, 20_000);
});
