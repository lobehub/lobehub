import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentIdentityConfig } from '../agentIdentity';

describe('getAgentIdentityConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports each provider as its own capability', () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');
    vi.stubEnv('LINQ_API_KEY', '');

    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: false,
      ENABLED_AGENT_MAIL: false,
      ENABLED_LINQ: false,
    });

    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: true,
      ENABLED_AGENT_MAIL: true,
      ENABLED_LINQ: false,
    });

    vi.stubEnv('LINQ_API_KEY', 'linq_test');
    const both = getAgentIdentityConfig();
    expect(both).toMatchObject({ ENABLED_AGENT_MAIL: true, ENABLED_LINQ: true });
    expect(both.AGENT_MAIL_API_KEY).toBe('am_test');
  });

  it('carries the optional configuration through', () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    vi.stubEnv('AGENT_MAIL_WEBHOOK_URL', 'https://app.lobehub.com/hook');
    vi.stubEnv('LINQ_API_KEY', 'linq_test');
    vi.stubEnv('LINQ_FROM_NUMBER', '+15550002222');

    const env = getAgentIdentityConfig();
    expect(env.AGENT_MAIL_WEBHOOK_URL).toBe('https://app.lobehub.com/hook');
    expect(env.LINQ_FROM_NUMBER).toBe('+15550002222');
  });
});
