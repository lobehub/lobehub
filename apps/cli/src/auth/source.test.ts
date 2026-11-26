import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCredentials } from './credentials';
import { pickAuthSource } from './source';

vi.mock('./credentials', () => ({ loadCredentials: vi.fn() }));

describe('pickAuthSource', () => {
  beforeEach(() => {
    vi.stubEnv('LOBEHUB_JWT', '');
    vi.stubEnv('LOBEHUB_CLI_API_KEY', 'machine-api-key');
    vi.stubEnv('LOBEHUB_OPERATION_ID', '');
    vi.stubEnv('LOBEHUB_TOPIC_ID', '');
    vi.mocked(loadCredentials).mockReturnValue({ accessToken: 'machine-login' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the API key from the environment outside an agent run', () => {
    expect(pickAuthSource()).toMatchObject({ kind: 'env-api-key', token: 'machine-api-key' });
  });

  /**
   * Regression: a run without its own sign-in fell through to the API key exported in the
   * user's shell, or to the stored login — both belong to the machine, not to the run.
   */
  it('offers no machine credential inside an agent run', () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc_1');

    const source = pickAuthSource();

    expect(source.kind).toBe('stored');
    expect(source.token).toBeUndefined();
    expect(loadCredentials).not.toHaveBeenCalled();
  });

  it("still uses the run's own sign-in inside an agent run", () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc_1');
    vi.stubEnv('LOBEHUB_JWT', 'run-token');

    expect(pickAuthSource()).toMatchObject({ kind: 'env-jwt', token: 'run-token' });
  });
});
