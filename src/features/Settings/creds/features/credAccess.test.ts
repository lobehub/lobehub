import { type UserCredSummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { credsApiForRow, isActionableCredRow, isOwnCredRow } from './credAccess';

const baseCred = {
  createdAt: '2024-01-01T00:00:00.000Z',
  id: 1,
  key: 'GITHUB_TOKEN',
  name: 'GitHub',
  type: 'kv-env' as const,
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const orgOwnedRow: UserCredSummary = {
  ...baseCred,
  ownerAccountId: 100,
  ownerType: 'organization',
};

const myOwnRow: UserCredSummary = {
  ...baseCred,
  ownerAccountId: 42,
  ownerType: 'user',
};

const anotherMembersRow: UserCredSummary = {
  ...baseCred,
  ownerAccountId: 99,
  ownerType: 'user',
};

const myAccountId = 42;

describe('isOwnCredRow', () => {
  it('is true for a "user"-owned row whose ownerAccountId matches the signed-in account', () => {
    expect(isOwnCredRow(myOwnRow, myAccountId)).toBe(true);
  });

  it("is false for another member's row even though ownerType is also 'user'", () => {
    expect(isOwnCredRow(anotherMembersRow, myAccountId)).toBe(false);
  });

  it('is false for an org-owned row', () => {
    expect(isOwnCredRow(orgOwnedRow, myAccountId)).toBe(false);
  });

  it('is false when the signed-in account id is unknown (not yet loaded)', () => {
    expect(isOwnCredRow(myOwnRow, undefined)).toBe(false);
  });
});

describe('isActionableCredRow', () => {
  it('is true for an org-owned row', () => {
    expect(isActionableCredRow(orgOwnedRow, myAccountId)).toBe(true);
  });

  it("is true for the signed-in member's own row", () => {
    expect(isActionableCredRow(myOwnRow, myAccountId)).toBe(true);
  });

  it("is false for another member's row — no endpoint can reach it", () => {
    expect(isActionableCredRow(anotherMembersRow, myAccountId)).toBe(false);
  });
});

describe('credsApiForRow', () => {
  const contextApi = 'workspaceCreds' as const;
  const personalApi = 'marketCreds' as const;

  it('routes an org-owned row to the context (workspace) API', () => {
    expect(credsApiForRow(orgOwnedRow, myAccountId, contextApi, personalApi)).toBe(contextApi);
  });

  it("routes the signed-in member's own row to the personal API", () => {
    expect(credsApiForRow(myOwnRow, myAccountId, contextApi, personalApi)).toBe(personalApi);
  });

  it("routes another member's row to the context API, not the personal one — the caller must gate on isActionableCredRow first and never call this for such a row in practice", () => {
    // credsApiForRow has no "no valid endpoint" return value, so this
    // documents the fallback rather than endorsing it: CredsList only calls
    // apiFor() after confirming isActionable(cred), so this branch is never
    // reached for another member's row in the real component.
    expect(credsApiForRow(anotherMembersRow, myAccountId, contextApi, personalApi)).toBe(
      contextApi,
    );
  });
});
