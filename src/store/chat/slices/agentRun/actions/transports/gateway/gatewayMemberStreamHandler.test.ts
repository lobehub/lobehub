import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ConversationContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createGatewayMemberStreamHandler } from './gatewayMemberStreamHandler';

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
      memberOperationId: 'server-member-op',
      parentOperationId: 'owner-op',
    });

    handler(makeEvent('stream_start', { assistantMessage: { id: 'member-msg' } }));
    handler(makeEvent('visible_output_end'));

    expect(store.updateOperationMetadata).toHaveBeenCalledWith('local-member-op', {
      visibleLoadingDone: true,
    });
    expect(store.completeOperation).not.toHaveBeenCalled();
  });

  it('skips the visible loading hint while the member row is not yet in the store (LOBE-11501)', () => {
    // Group hydration is still in flight, so the member row hasn't landed. Clearing
    // loading here would show a "done" column with no text — the guard skips it and
    // lets the terminal barrier reconcile.
    const store = createStore();
    const handler = createGatewayMemberStreamHandler(() => store, {
      context,
      ensureGroupHydrated: vi.fn().mockResolvedValue(undefined),
      memberOperationId: 'server-member-op',
      parentOperationId: 'owner-op',
    });

    handler(makeEvent('stream_start', { assistantMessage: { id: 'member-msg' } }));
    handler(makeEvent('visible_output_end'));

    expect(store.updateOperationMetadata).not.toHaveBeenCalled();
  });
});
