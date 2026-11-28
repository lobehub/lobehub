import { describe, expect, it } from 'vitest';

import {
  parseClaudeAccountIdentity,
  parseClaudeCredentialPlan,
  parseCodexAccountIdentity,
} from './identity';

describe('identity parsing', () => {
  it('parses Claude ~/.claude.json oauthAccount', () => {
    const id = parseClaudeAccountIdentity(
      JSON.stringify({
        oauthAccount: {
          accountUuid: '687dc4eb-2aad-45fc-92be-402acbe51661',
          displayName: 'Arvin',
          emailAddress: 'a@example.com',
          organizationRateLimitTier: 'default_claude_max_20x',
          organizationType: 'claude_max',
          organizationUuid: 'org-1',
        },
      }),
    );
    expect(id).toEqual({
      displayName: 'Arvin',
      email: 'a@example.com',
      externalAccountId: '687dc4eb-2aad-45fc-92be-402acbe51661',
      organizationId: 'org-1',
      planTier: 'max',
      rateLimitTier: 'default_claude_max_20x',
    });
  });

  it('returns null without an account uuid', () => {
    expect(parseClaudeAccountIdentity('{}')).toBeNull();
    expect(parseClaudeAccountIdentity('not json')).toBeNull();
  });

  it('reads plan hints from the credential blob', () => {
    const plan = parseClaudeCredentialPlan(
      JSON.stringify({
        claudeAiOauth: {
          expiresAt: 123,
          rateLimitTier: 'default_claude_max_20x',
          subscriptionType: 'max',
        },
      }),
    );
    expect(plan).toEqual({
      expiresAt: 123,
      planTier: 'max',
      rateLimitTier: 'default_claude_max_20x',
    });
  });

  it('parses Codex auth.json + id_token claims', () => {
    const claims = {
      'email': 'a@example.com',
      'https://api.openai.com/auth': { chatgpt_account_id: 'acc-x', chatgpt_plan_type: 'pro' },
    };
    const b64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const idToken = `h.${b64}.s`;
    const id = parseCodexAccountIdentity(
      JSON.stringify({ tokens: { account_id: 'acc-x', id_token: idToken } }),
    );
    expect(id).toEqual({ email: 'a@example.com', externalAccountId: 'acc-x', planTier: 'pro' });
  });

  it('returns null for empty codex auth', () => {
    expect(parseCodexAccountIdentity('{}')).toBeNull();
  });
});
