import { describe, expect, it } from 'vitest';

import {
  redactAgentCredentialParams,
  REDACTED,
  scrubAgentCredentialText,
  toRedactedAgentCredentialError,
} from './redact';

const TOKEN = 'sk-ant-oat01-secret-token-value';
const ACCESS = 'codex-access-token-value';

describe('redactAgentCredentialParams', () => {
  it('keeps the provider, type and expiry and hides the token', () => {
    const params = {
      provider: 'claude-code',
      secret: { expiresAt: '2026-07-01T00:00:00.000Z', token: TOKEN, type: 'claude-oauth-token' },
    };

    const redacted = redactAgentCredentialParams(params);

    expect(redacted).toEqual({
      provider: 'claude-code',
      secret: {
        expiresAt: '2026-07-01T00:00:00.000Z',
        token: REDACTED,
        type: 'claude-oauth-token',
      },
    });
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    // The input is not mutated.
    expect(params.secret.token).toBe(TOKEN);
  });

  it('hides a Codex auth.json', () => {
    const redacted = redactAgentCredentialParams({
      provider: 'codex',
      secret: {
        authJson: JSON.stringify({ tokens: { access_token: ACCESS } }),
        type: 'codex-auth-json',
      },
    });
    expect(JSON.stringify(redacted)).not.toContain(ACCESS);
  });

  it('passes params without a secret through', () => {
    expect(redactAgentCredentialParams({ provider: 'codex' })).toEqual({ provider: 'codex' });
  });
});

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
      `failed near ${REDACTED}`,
    );
  });

  it('rebuilds an error without the secret', () => {
    const params = {
      provider: 'claude-code',
      secret: { token: TOKEN, type: 'claude-oauth-token' },
    };
    const error = toRedactedAgentCredentialError(new Error(`EACCES writing ${TOKEN}`), params);
    expect(error.message).toBe(`EACCES writing ${REDACTED}`);
  });
});
