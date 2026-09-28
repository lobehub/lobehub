import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ConversationContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createGatewayMemberStreamHandler, mergeGroupSnapshot } from './gatewayMemberStreamHandler';

const context = {
  agentId: 'member-agent',
  groupId: 'group-1',
  scope: 'group',
  topicId: 'topic-1',
} as ConversationContext;

const bucketKey = messageMapKey({
  agentId: context.agentId ?? '',
  groupId: context.groupId,
  scope: context.scope,
  threadId: context.threadId,
  topicId: context.topicId,
});

const makeEvent = (type: AgentStreamEvent['type'], data?: AgentStreamEvent['data']) =>
  ({
    data,
    id: 'event-1',
    operationId: 'server-member-op',
    stepIndex: 0,
    timestamp: 0,
    type,
  }) as AgentStreamEvent;

const createStore = (dbMessagesMap: Record<string, any[]> = {}) =>
  ({
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap,
    internal_dispatchMessage: vi.fn(),
    startOperation: vi.fn(() => ({
      abortController: new AbortController(),
      operationId: 'local-member-op',
    })),
    updateOperationMetadata: vi.fn(),
  }) as unknown as ChatStore;

describe('createGatewayMemberStreamHandler', () => {
  it('clears visible loading for the local member op without completing it', () => {
    // The member row is already hydrated into the store (group hydration done),
    // so the visible_output_end hint is honored.
    const store = createStore({
      [bucketKey]: [{ content: 'hello', id: 'member-msg', role: 'assistant' }],
    });
    const handler = createGatewayMemberStreamHandler(() => store, {
      context,
      ensureGroupHydrated: vi.fn().mockResolvedValue(undefined),
      liveMessageIds: new Set<string>(),
      memberOperationId: 'server-member-op',
      parentOperationId: 'owner-op',
      refreshGroup: vi.fn().mockResolvedValue(undefined),
    });

    handler(makeEvent('stream_start', { assistantMessage: { id: 'member-msg' } }));
    handler(makeEvent('visible_output_end'));

    expect(store.updateOperationMetadata).toHaveBeenCalledWith('local-member-op', {
      visibleLoadingDone: true,
    });
    expect(store.completeOperation).not.toHaveBeenCalled();
  });

  it('skips the visible loading hint while the member row is not yet in the store ', () => {
    // Group hydration is still in flight, so the member row hasn't landed. Clearing
    // loading here would show a "done" column with no text — the guard skips it and
    // lets the terminal barrier reconcile.
    const store = createStore();
    const handler = createGatewayMemberStreamHandler(() => store, {
      context,
      ensureGroupHydrated: vi.fn().mockResolvedValue(undefined),
      liveMessageIds: new Set<string>(),
      memberOperationId: 'server-member-op',
      parentOperationId: 'owner-op',
      refreshGroup: vi.fn().mockResolvedValue(undefined),
    });

    handler(makeEvent('stream_start', { assistantMessage: { id: 'member-msg' } }));
    handler(makeEvent('visible_output_end'));

    expect(store.updateOperationMetadata).not.toHaveBeenCalled();
  });

  // G-05: a member parked on a human approval ends while the supervisor keeps
  // waiting on it, so no terminal refetch ever brings its pending tool row in —
  // without a read of its own the approval card only shows after a reload.
  describe('member parked on a human approval', () => {
    const setup = () => {
      const store = createStore();
      const refreshGroup = vi.fn().mockResolvedValue(undefined);
      const ensureGroupHydrated = vi.fn().mockResolvedValue(undefined);
      const liveMessageIds = new Set<string>();
      const handler = createGatewayMemberStreamHandler(() => store, {
        context,
        ensureGroupHydrated,
        liveMessageIds,
        memberOperationId: 'server-member-op',
        parentOperationId: 'owner-op',
        refreshGroup,
      });
      handler(makeEvent('stream_start', { assistantMessage: { id: 'member-msg' } }));
      return { ensureGroupHydrated, handler, liveMessageIds, refreshGroup, store };
    };

    it('re-reads the group tree so the approval card lands live (G-05)', async () => {
      const { handler, refreshGroup, store } = setup();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_human' }));
      await vi.waitFor(() => expect(refreshGroup).toHaveBeenCalledTimes(1));

      expect(store.completeOperation).toHaveBeenCalledWith('local-member-op');
    });

    // Codex P1 on #20093: both reads replace the whole bucket, so the refresh
    // must not race an in-flight stream_start hydration that could land last.
    it('waits for the in-flight hydration before refreshing', async () => {
      const { ensureGroupHydrated, handler, refreshGroup } = setup();
      let finishHydration!: () => void;
      ensureGroupHydrated.mockReturnValue(
        new Promise<void>((resolve) => {
          finishHydration = resolve;
        }),
      );

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_human' }));
      await Promise.resolve();
      expect(refreshGroup).not.toHaveBeenCalled();

      finishHydration();
      await vi.waitFor(() => expect(refreshGroup).toHaveBeenCalledTimes(1));
    });

    // Codex P1 on #20093: a failed approval read used to be swallowed, leaving
    // the parked turn without its card until a reload.
    it('retries a failed approval refresh', async () => {
      const { handler, refreshGroup } = setup();
      refreshGroup
        .mockRejectedValueOnce(new Error('network'))
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValue(undefined);

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_human' }));

      await vi.waitFor(() => expect(refreshGroup).toHaveBeenCalledTimes(3), { timeout: 4000 });
    });

    it('leaves a normal member end to the supervisor terminal refetch', () => {
      const { handler, refreshGroup } = setup();

      handler(makeEvent('agent_runtime_end', { reason: 'completed' }));

      expect(refreshGroup).not.toHaveBeenCalled();
    });
  });

  // Codex P1 on #20093: the approval re-read replaced the whole bucket, rolling
  // a still-streaming sibling's column back to its lagging database snapshot.
  describe('live sibling rows', () => {
    it('tracks the row a member is streaming until it ends', () => {
      const liveMessageIds = new Set<string>();
      const handler = createGatewayMemberStreamHandler(() => createStore(), {
        context,
        ensureGroupHydrated: vi.fn().mockResolvedValue(undefined),
        liveMessageIds,
        memberOperationId: 'server-member-op',
        parentOperationId: 'owner-op',
        refreshGroup: vi.fn().mockResolvedValue(undefined),
      });

      handler(makeEvent('stream_start', { assistantMessage: { id: 'member-msg' } }));
      expect([...liveMessageIds]).toEqual(['member-msg']);

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_human' }));
      expect(liveMessageIds.size).toBe(0);
    });

    it("keeps a live sibling's in-memory row and takes the snapshot for the rest", () => {
      const fetched = [
        { content: 'db stale', id: 'sibling-msg', role: 'assistant' },
        {
          content: '',
          id: 'approval-tool',
          pluginIntervention: { status: 'pending' },
          role: 'tool',
        },
      ] as any[];
      const current = [
        { content: 'live streamed text', id: 'sibling-msg', role: 'assistant' },
      ] as any[];

      expect(mergeGroupSnapshot(fetched, current, new Set(['sibling-msg']))).toEqual([
        current[0],
        fetched[1],
      ]);
    });

    it('takes the snapshot as-is when no member is streaming', () => {
      const fetched = [{ content: 'db', id: 'a', role: 'assistant' }] as any[];

      expect(mergeGroupSnapshot(fetched, [], new Set())).toBe(fetched);
    });
  });
});
