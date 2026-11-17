// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attestedOwnerToken, issueWorktreeReceipt } from './receipt';

describe('worktree creation receipts', () => {
  const previous = process.env.KEY_VAULTS_SECRET;
  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = 'test-secret';
  });
  afterEach(() => {
    process.env.KEY_VAULTS_SECRET = previous;
  });

  it('verifies only for the creator it was issued to', () => {
    const receipt = issueWorktreeReceipt('user-a')!;
    expect(receipt.token).toMatch(/^[\w-]{16,128}$/);
    const entry = { ownerNonce: receipt.nonce, ownerToken: receipt.token };

    expect(attestedOwnerToken('user-a', entry)).toBe(receipt.token);
    // Copied into another member's topic, it proves nothing.
    expect(attestedOwnerToken('user-b', entry)).toBeUndefined();
    expect(attestedOwnerToken('user-a', { ...entry, ownerNonce: 'other-nonce' })).toBeUndefined();
    expect(attestedOwnerToken('user-a', { ownerToken: receipt.token })).toBeUndefined();
  });

  it('issues and verifies nothing without a server secret', () => {
    const receipt = issueWorktreeReceipt('user-a')!;
    delete process.env.KEY_VAULTS_SECRET;
    expect(issueWorktreeReceipt('user-a')).toBeUndefined();
    expect(
      attestedOwnerToken('user-a', { ownerNonce: receipt.nonce, ownerToken: receipt.token }),
    ).toBeUndefined();
  });
});
