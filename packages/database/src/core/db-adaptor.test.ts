// @vitest-environment node
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
    expect(typeof adaptor.serverDB).toBe('object');
  }, 20_000);

  it('forwards the database object protocol after first access', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DATABASE_DRIVER', 'node');
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost:1/db');
    vi.stubEnv('KEY_VAULTS_SECRET', 'test-secret');

    const { serverDB } = await import('./server-db');

    expect(serverDB.dialect).toBeDefined();
    expect(serverDB.session).toBeDefined();
    expect('query' in serverDB).toBe(true);
    expect(Object.keys(serverDB)).toContain('dialect');
    expect(Object.getPrototypeOf(serverDB)?.constructor?.name).toBe('NodePgDatabase');
  }, 20_000);
});
