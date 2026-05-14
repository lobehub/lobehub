import { describe, expect, it } from 'vitest';

import { buildBotContext } from './buildBotContext';

describe('buildBotContext', () => {
  const baseParams = {
    applicationId: 'app-123',
    platform: 'discord',
    platformThreadId: 'thread-1',
  };

  it('marks sender as owner when authorUserId matches operatorUserId', () => {
    const ctx = buildBotContext({
      ...baseParams,
      authorUserId: 'user-1',
      operatorUserId: 'user-1',
    });
    expect(ctx.isOwner).toBe(true);
    expect(ctx.senderExternalUserId).toBe('user-1');
  });

  it('marks sender as NOT owner when authorUserId differs from operatorUserId', () => {
    const ctx = buildBotContext({
      ...baseParams,
      authorUserId: 'sender-2',
      operatorUserId: 'owner-1',
    });
    expect(ctx.isOwner).toBe(false);
    expect(ctx.senderExternalUserId).toBe('sender-2');
  });

  it('fails closed when operatorUserId is undefined (LOBE-8768 contract)', () => {
    const ctx = buildBotContext({
      ...baseParams,
      authorUserId: 'sender-1',
      operatorUserId: undefined,
    });
    expect(ctx.isOwner).toBe(false);
  });

  it('fails closed when both operator and author are missing', () => {
    const ctx = buildBotContext({
      ...baseParams,
      authorUserId: undefined,
      operatorUserId: undefined,
    });
    expect(ctx.isOwner).toBe(false);
    expect(ctx.senderExternalUserId).toBe('');
  });

  it('fails closed when authorUserId is undefined even with operator configured', () => {
    // Without `senderExternalUserId === ''` matching `operatorUserId`,
    // a missing author must never count as the owner.
    const ctx = buildBotContext({
      ...baseParams,
      authorUserId: undefined,
      operatorUserId: 'owner-1',
    });
    expect(ctx.isOwner).toBe(false);
    expect(ctx.senderExternalUserId).toBe('');
  });

  it('does NOT match when operatorUserId is the empty string and author is missing', () => {
    // Both default to '', but an empty operator means "not configured" —
    // never trust the resulting all-empty equality.
    const ctx = buildBotContext({
      ...baseParams,
      authorUserId: undefined,
      operatorUserId: '',
    });
    expect(ctx.isOwner).toBe(false);
  });

  it('passes through platform / applicationId / platformThreadId verbatim', () => {
    const ctx = buildBotContext({
      applicationId: 'app-x',
      authorUserId: 'a',
      operatorUserId: 'a',
      platform: 'slack',
      platformThreadId: 'thread-x',
    });
    expect(ctx).toMatchObject({
      applicationId: 'app-x',
      platform: 'slack',
      platformThreadId: 'thread-x',
    });
  });
});
