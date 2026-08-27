import { describe, expect, it } from 'vitest';

import {
  assertResolvedPrincipal,
  createDelegatedPrincipal,
  createOwnerPrincipal,
  isDelegatedRun,
  resolveRunPrincipal,
  toDelegationMarker,
} from './index';

const delegation = {
  agentId: 'agt_1',
  grants: { allowReadMemory: false, enabledToolIds: ['a'] },
  shareId: 'share-1',
};

describe('createOwnerPrincipal', () => {
  it('makes the actor and the resource owner the same user, with no delegation', () => {
    expect(createOwnerPrincipal('user-1')).toEqual({
      actorUserId: 'user-1',
      resourceOwnerUserId: 'user-1',
    });
  });
});

describe('resolveRunPrincipal', () => {
  it('treats a run without a share marker as an ordinary owner run', () => {
    const principal = resolveRunPrincipal({ userId: 'user-1' });

    expect(principal.actorUserId).toBe('user-1');
    expect(principal.resourceOwnerUserId).toBe('user-1');
    expect(isDelegatedRun(principal)).toBe(false);
  });

  it('splits the visitor (actor) from the creator (resource owner) on a share run', () => {
    const principal = resolveRunPrincipal({
      agentShare: {
        agentId: 'agt_1',
        allowReadMemory: true,
        enabledToolIds: ['a'],
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
      userId: 'creator-1',
    });

    expect(principal.actorUserId).toBe('visitor-1');
    expect(principal.resourceOwnerUserId).toBe('creator-1');
    expect(principal.delegation).toMatchObject({ agentId: 'agt_1', shareId: 'share-1' });
    expect(principal.delegation?.grants).toMatchObject({
      allowReadMemory: true,
      enabledToolIds: ['a'],
    });
  });
});

describe('toDelegationMarker', () => {
  it('returns undefined for an ordinary run so consumers bill and attribute normally', () => {
    expect(toDelegationMarker(createOwnerPrincipal('user-1'))).toBeUndefined();
  });

  it('emits a half-built marker rather than collapsing it to undefined', () => {
    // A missing `actorUserId` alongside a delegation means the upstream wiring
    // is broken. Returning `undefined` here would read as "ordinary run" and
    // silently bill the creator personally for a visitor's inference, so the
    // broken marker must propagate to the consumers' own fail-closed checks.
    const marker = toDelegationMarker({ delegation, resourceOwnerUserId: 'creator-1' });

    expect(marker).toEqual({ agentId: 'agt_1', visitorUserId: undefined });
  });
});

describe('assertResolvedPrincipal', () => {
  it('narrows a complete principal unchanged', () => {
    const principal = createDelegatedPrincipal({
      actorUserId: 'visitor-1',
      delegation,
      resourceOwnerUserId: 'creator-1',
    });

    expect(assertResolvedPrincipal(principal, 'TestService')).toEqual(principal);
  });

  it.each([
    ['a missing resourceOwnerUserId', { actorUserId: 'visitor-1' }],
    ['a missing actorUserId', { resourceOwnerUserId: 'creator-1' }],
    ['both ids missing', {}],
  ])('fails closed on %s, naming the boundary', (_label, principal) => {
    // Failing closed matters more than the message: a holder that accepted an
    // incomplete principal would construct its models with `undefined` and
    // silently widen their `WHERE user_id = ?` filters instead of erroring.
    expect(() => assertResolvedPrincipal(principal, 'TestService')).toThrow(/TestService/);
  });
});
