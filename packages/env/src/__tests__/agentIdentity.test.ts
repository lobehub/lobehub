import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentIdentityConfig } from '../agentIdentity';

describe('getAgentIdentityConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enables agent identity only when the Agent Mail key is present', () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');

    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: false,
      ENABLED_AGENT_MAIL: false,
    });

    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    const enabled = getAgentIdentityConfig();
    expect(enabled).toMatchObject({
      ENABLED_AGENT_IDENTITY: true,
      ENABLED_AGENT_MAIL: true,
    });
    expect(enabled.AGENT_MAIL_API_KEY).toBe('am_test');
  });

  it('ignores Linq keys, which belong to the messenger platform', () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', '');
    vi.stubEnv('LINQ_API_KEY', 'linq_test');

    const env = getAgentIdentityConfig();
    expect(env).toMatchObject({ ENABLED_AGENT_IDENTITY: false, ENABLED_AGENT_MAIL: false });
    expect(env).not.toHaveProperty('ENABLED_LINQ');
  });

  it('carries the optional configuration through', () => {
    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    vi.stubEnv('AGENT_MAIL_WEBHOOK_URL', 'https://app.lobehub.com/hook');

    const env = getAgentIdentityConfig();
    expect(env.AGENT_MAIL_WEBHOOK_URL).toBe('https://app.lobehub.com/hook');
  });
});
