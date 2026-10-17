import type { AgentState } from '@lobechat/agent-runtime';
import { describe, expect, it } from 'vitest';

import {
  buildRunIdentity,
  isShareVisitorActor,
  resolveRunActor,
  resolveRunActorFromMetadata,
  resolveRunActorFromState,
} from '../runIdentity';

const shareVisitor = { shareId: 'share_1', visitorUserId: 'visitor_1' };

describe('buildRunIdentity', () => {
  it('stamps an ordinary personal run as operated and owned by its user', () => {
    expect(buildRunIdentity({ userId: 'user_1' })).toEqual({
      actor: { kind: 'user', userId: 'user_1' },
      owner: { type: 'user', userId: 'user_1' },
      version: 1,
    });
  });

  it('owns a workspace run by the workspace, not the member running it', () => {
    expect(buildRunIdentity({ userId: 'member_1', workspaceId: 'ws_1' })).toEqual({
      actor: { kind: 'user', userId: 'member_1' },
      owner: { type: 'workspace', workspaceId: 'ws_1' },
      version: 1,
    });
  });

  it('operates a personal share run as the visitor while the creator owns it', () => {
    expect(buildRunIdentity({ shareVisitor, userId: 'creator_1' })).toEqual({
      actor: { kind: 'shareVisitor', shareId: 'share_1', userId: 'visitor_1' },
      owner: { type: 'user', userId: 'creator_1' },
      version: 1,
    });
  });

  it('owns a workspace share run by the workspace', () => {
    expect(buildRunIdentity({ shareVisitor, userId: 'creator_1', workspaceId: 'ws_1' })).toEqual({
      actor: { kind: 'shareVisitor', shareId: 'share_1', userId: 'visitor_1' },
      owner: { type: 'workspace', workspaceId: 'ws_1' },
      version: 1,
    });
  });

  it('keeps a creator chatting through their own share link a share-visitor run', () => {
    const identity = buildRunIdentity({
      shareVisitor: { shareId: 'share_1', visitorUserId: 'creator_1' },
      userId: 'creator_1',
    });

    expect(identity.actor).toEqual({
      kind: 'shareVisitor',
      shareId: 'share_1',
      userId: 'creator_1',
    });
    expect(identity.owner).toEqual({ type: 'user', userId: 'creator_1' });
    expect(isShareVisitorActor(identity.actor)).toBe(true);
  });

  it('operates a bot-triggered run as the LobeHub user it is bound to', () => {
    // The platform sender stays on `principal.actor.bot`; the run itself
    // streams to, and is answered by, the bound user.
    expect(buildRunIdentity({ userId: 'bound_user' }).actor).toEqual({
      kind: 'user',
      userId: 'bound_user',
    });
  });
});

describe('resolveRunActor', () => {
  const visitorSnapshot = buildRunIdentity({ shareVisitor, userId: 'creator_1' });
  const userSnapshot = buildRunIdentity({ userId: 'creator_1' });

  describe('an operation created without a snapshot', () => {
    it('derives a share-visitor actor from the mirrored visitor id', () => {
      expect(
        resolveRunActor(undefined, { shareVisitorUserId: 'visitor_1', userId: 'creator_1' }),
      ).toEqual({
        actor: { kind: 'shareVisitor', userId: 'visitor_1' },
        ok: true,
        source: 'record',
      });
    });

    it('derives an ordinary actor from the executing user', () => {
      expect(resolveRunActor(undefined, { shareVisitorUserId: null, userId: 'creator_1' })).toEqual(
        { actor: { kind: 'user', userId: 'creator_1' }, ok: true, source: 'record' },
      );
    });

    it('reports a record with nothing to derive from as missing', () => {
      expect(resolveRunActor(undefined, { shareVisitorUserId: null })).toEqual({
        ok: false,
        reason: 'missing',
      });
    });
  });

  it('reads the snapshot when its share marker agrees with the record', () => {
    expect(
      resolveRunActor(visitorSnapshot, { shareVisitorUserId: 'visitor_1', userId: 'creator_1' }),
    ).toEqual({ actor: visitorSnapshot.actor, ok: true, source: 'snapshot' });
    expect(
      resolveRunActor(userSnapshot, { shareVisitorUserId: null, userId: 'creator_1' }),
    ).toEqual({ actor: userSnapshot.actor, ok: true, source: 'snapshot' });
  });

  it('reads the snapshot when the record cannot tell', () => {
    expect(resolveRunActor(visitorSnapshot, { userId: 'creator_1' })).toMatchObject({
      actor: { kind: 'shareVisitor', userId: 'visitor_1' },
      ok: true,
    });
  });

  it.each([
    ['an ordinary snapshot on a record marked as a share run', userSnapshot, 'visitor_1'],
    ['a share snapshot on a record marked as ordinary', visitorSnapshot, null],
    ['a share snapshot naming another visitor', visitorSnapshot, 'visitor_2'],
  ])('refuses %s', (_, snapshot, shareVisitorUserId) => {
    expect(resolveRunActor(snapshot, { shareVisitorUserId, userId: 'creator_1' })).toEqual({
      ok: false,
      reason: 'conflict',
    });
  });

  it('refuses an ordinary snapshot naming someone other than the executing user', () => {
    // Stream access and the Gateway channel go to an ordinary run's actor.
    expect(
      resolveRunActor(userSnapshot, { shareVisitorUserId: null, userId: 'creator_2' }),
    ).toEqual({ ok: false, reason: 'conflict' });
  });

  it('reads an ordinary snapshot when the record names no executing user', () => {
    expect(resolveRunActor(userSnapshot, { shareVisitorUserId: null })).toEqual({
      actor: userSnapshot.actor,
      ok: true,
      source: 'snapshot',
    });
  });

  it('reads a version 1 snapshot carrying fields added by a newer build', () => {
    // Additive fields keep `version: 1`, so a worker still on this build keeps
    // reading runs a newer writer stamped during a rolling deploy.
    const extended = { ...visitorSnapshot, payer: { type: 'user', userId: 'creator_1' } };

    expect(
      resolveRunActor(extended, { shareVisitorUserId: 'visitor_1', userId: 'creator_1' }),
    ).toEqual({ actor: visitorSnapshot.actor, ok: true, source: 'snapshot' });
  });

  it('refuses a snapshot version this build does not know', () => {
    expect(
      resolveRunActor({ ...visitorSnapshot, version: 2 }, { shareVisitorUserId: 'visitor_1' }),
    ).toEqual({ ok: false, reason: 'unsupported_version' });
  });

  it.each([
    ['unreadable stored JSON', '{"actor":'],
    ['a snapshot without an owner', { actor: visitorSnapshot.actor, version: 1 }],
    ['an unknown actor kind', { ...userSnapshot, actor: { kind: 'bot', userId: 'creator_1' } }],
    ['an empty actor id', { ...userSnapshot, actor: { kind: 'user', userId: '' } }],
  ])('refuses %s as invalid', (_, snapshot) => {
    expect(resolveRunActor(snapshot, { shareVisitorUserId: null, userId: 'creator_1' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('resolveRunActorFromMetadata', () => {
  it('reports absent operation metadata as missing', () => {
    expect(resolveRunActorFromMetadata(null)).toEqual({ ok: false, reason: 'missing' });
  });

  it('treats a missing mirror as authoritative once a snapshot is present', () => {
    expect(
      resolveRunActorFromMetadata({
        identity: buildRunIdentity({ shareVisitor, userId: 'creator_1' }),
        userId: 'creator_1',
      }),
    ).toEqual({ ok: false, reason: 'conflict' });
  });
});

describe('resolveRunActorFromState', () => {
  const stateWith = (principal: AgentState['principal']) =>
    ({ origin: { userId: 'creator_1' }, principal }) as Pick<AgentState, 'origin' | 'principal'>;

  it('derives the visitor of a share run created before the snapshot existed', () => {
    expect(
      resolveRunActorFromState(
        stateWith({ actor: { shareVisitor: { agentId: 'agt_1', ...shareVisitor } } }),
      ),
    ).toEqual({
      actor: { kind: 'shareVisitor', userId: 'visitor_1' },
      ok: true,
      source: 'record',
    });
  });

  it('refuses a share snapshot on a state without the share grants', () => {
    expect(
      resolveRunActorFromState(
        stateWith({ identity: buildRunIdentity({ shareVisitor, userId: 'creator_1' }) }),
      ),
    ).toEqual({ ok: false, reason: 'conflict' });
  });
});
