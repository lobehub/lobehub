import { describe, expect, it } from 'vitest';

import {
  countDroppedAccounts,
  isOAuthClientChanged,
  type OAuthBaseline,
  requiresOAuth,
} from './oauthPlan';

const URL = 'https://mail.example.com/mcp';

/** An OAuth connector on a server-resolved (DCR) client with two accounts. */
const connected: OAuthBaseline = { accountCount: 2, authType: 'oauth2', mcpServerUrl: URL };
const untouched = { url: URL };

describe('requiresOAuth', () => {
  it('authorizes a connector that is being created', () => {
    expect(requiresOAuth(undefined, untouched)).toBe(true);
  });

  it('saves in place when neither the server nor the client changed', () => {
    expect(requiresOAuth(connected, untouched)).toBe(false);
    // Whitespace and an emptied optional field are not edits.
    expect(requiresOAuth(connected, { clientId: '  ', clientSecret: '', url: ` ${URL} ` })).toBe(
      false,
    );
  });

  it('authorizes when the server URL changed', () => {
    expect(requiresOAuth(connected, { url: 'https://other.example.com/mcp' })).toBe(true);
  });

  it('authorizes when the OAuth client changed', () => {
    expect(requiresOAuth(connected, { clientId: 'my-client', url: URL })).toBe(true);
    expect(requiresOAuth(connected, { clientSecret: 'new-secret', url: URL })).toBe(true);
  });

  it('authorizes when no account is connected yet', () => {
    expect(requiresOAuth({ ...connected, accountCount: 0 }, untouched)).toBe(true);
  });
});

describe('isOAuthClientChanged', () => {
  it('keeps a hand-registered client whose id is left as it was', () => {
    const preRegistered = { ...connected, clientId: 'my-client' };
    expect(isOAuthClientChanged(preRegistered, { clientId: 'my-client', url: URL })).toBe(false);
    expect(isOAuthClientChanged(preRegistered, { url: URL })).toBe(true);
  });

  it('treats switching another auth type to OAuth as a new client', () => {
    expect(isOAuthClientChanged({ accountCount: 0, authType: 'bearer' }, untouched)).toBe(true);
  });
});

describe('countDroppedAccounts', () => {
  it('counts every account when the URL or client id changes', () => {
    expect(countDroppedAccounts(connected, { url: 'https://other.example.com/mcp' })).toBe(2);
    expect(countDroppedAccounts(connected, { clientId: 'my-client', url: URL })).toBe(2);
  });

  it('drops nothing for a new secret, a plain save, or a new connector', () => {
    expect(countDroppedAccounts(connected, { clientSecret: 'new-secret', url: URL })).toBe(0);
    expect(countDroppedAccounts(connected, untouched)).toBe(0);
    expect(countDroppedAccounts(undefined, untouched)).toBe(0);
  });
});
