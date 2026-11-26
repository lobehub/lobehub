import { describe, expect, it } from 'vitest';

import { scrubAgentCredentialText, toRedactedAgentCredentialError } from './redact';

const TOKEN = 'sk-ant-oat01-secret-token-value';
const ACCESS = 'codex-access-token-value';

describe('scrubbing secrets from text', () => {
  it('removes the token and every token inside a Codex auth.json', () => {
    const params = {
      provider: 'codex',
      secret: {
        authJson: JSON.stringify({ tokens: { access_token: ACCESS } }),
        type: 'codex-auth-json',
      },
    };
    expect(scrubAgentCredentialText(`failed near ${ACCESS}`, params)).toBe(
      'failed near [redacted]',
    );
  });

  it('scrubs extra secrets the caller names', () => {
    expect(scrubAgentCredentialText(`Bearer ${TOKEN}`, undefined, [TOKEN])).toBe(
      'Bearer [redacted]',
    );
  });

  it('rebuilds an error without the secret, marked as a device-side failure', () => {
    const params = {
      provider: 'claude-code',
      secret: { token: TOKEN, type: 'claude-oauth-token' },
    };
    const error = toRedactedAgentCredentialError(new Error(`EACCES writing ${TOKEN}`), params);
    expect(error.message).toBe('Agent credential error: EACCES writing [redacted]');
  });
});
