import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentIdentityConfig } from '../agentIdentity';

const clearCarriers = () => {
  vi.stubEnv('AGENT_MAIL_API_KEY', '');
  vi.stubEnv('TWILIO_ACCOUNT_SID', '');
  vi.stubEnv('TWILIO_AUTH_TOKEN', '');
  vi.stubEnv('TELNYX_API_KEY', '');
  vi.stubEnv('TELNYX_PUBLIC_KEY', '');
  vi.stubEnv('TELNYX_MESSAGING_PROFILE_ID', '');
  vi.stubEnv('AGENT_NUMBER_WEBHOOK_BASE_URL', '');
  vi.stubEnv('AGENT_NUMBER_QUARANTINE_DAYS', '');
};

describe('getAgentIdentityConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports each provider as its own capability', () => {
    clearCarriers();

    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: false,
      ENABLED_AGENT_MAIL: false,
      ENABLED_TELNYX: false,
      ENABLED_TWILIO: false,
    });

    vi.stubEnv('AGENT_MAIL_API_KEY', 'am_test');
    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: true,
      ENABLED_AGENT_MAIL: true,
      ENABLED_TWILIO: false,
    });
  });

  it('enables a carrier only with its credentials AND a public webhook origin', () => {
    clearCarriers();
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');

    // A number nobody can text is not a feature: no webhook origin, no carrier.
    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: false,
      ENABLED_TWILIO: false,
    });

    vi.stubEnv('AGENT_NUMBER_WEBHOOK_BASE_URL', 'https://app.lobehub.com');
    expect(getAgentIdentityConfig()).toMatchObject({
      ENABLED_AGENT_IDENTITY: true,
      ENABLED_TELNYX: false,
      ENABLED_TWILIO: true,
    });

    vi.stubEnv('TELNYX_API_KEY', 'KEY_test');
    // Telnyx also needs the webhook-signing key and the messaging profile.
    expect(getAgentIdentityConfig().ENABLED_TELNYX).toBe(false);
    vi.stubEnv('TELNYX_PUBLIC_KEY', 'pk');
    vi.stubEnv('TELNYX_MESSAGING_PROFILE_ID', 'mp');
    expect(getAgentIdentityConfig().ENABLED_TELNYX).toBe(true);
  });

  it('defaults the number economics and clamps quarantine to 30–60 days', () => {
    clearCarriers();
    const env = getAgentIdentityConfig();
    expect(env.AGENT_NUMBER_QUARANTINE_DAYS).toBe(45);
    expect(env.AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD).toBe(20);
    expect(env.AGENT_NUMBER_POOL_SIZE).toBe(2);

    vi.stubEnv('AGENT_NUMBER_QUARANTINE_DAYS', '7');
    expect(getAgentIdentityConfig().AGENT_NUMBER_QUARANTINE_DAYS).toBe(30);
    vi.stubEnv('AGENT_NUMBER_QUARANTINE_DAYS', '365');
    expect(getAgentIdentityConfig().AGENT_NUMBER_QUARANTINE_DAYS).toBe(60);
  });
});
