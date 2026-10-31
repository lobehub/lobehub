import type { ChannelPublicMessage } from '@lobechat/types';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelThreadDraft } from './threadDraft';
import { useThreadPanel } from './useThreadPanel';

const { send, identity } = vi.hoisted(() => ({ send: vi.fn(), identity: { scope: 'one' } }));
vi.mock('@/store/channel', () => ({ channelActions: { send } }));
vi.mock('@/libs/replica', () => ({
  cacheScope: { get: () => identity.scope, use: () => identity.scope },
}));
const draft = (id = 'root'): ChannelThreadDraft => ({
  attachments: [],
  root: { id } as ChannelPublicMessage,
});
const setup = () =>
  renderHook(({ channelId }) => useThreadPanel(channelId), {
    initialProps: { channelId: 'channel' },
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: ['/channels/channel'] }, children),
  });

describe('Local thread preview', () => {
  beforeEach(() => {
    identity.scope = 'one';
    send.mockReset().mockResolvedValue({ threadId: 'saved' });
  });
  afterEach(() => cleanup());

  it('opens and closes without saving or assigning a thread ID', () => {
    const { result } = setup();
    act(() => result.current.openDraft(draft()));
    expect(result.current.draft?.root.id).toBe('root');
    expect(result.current.threadId).toBeNull();
    expect(send).not.toHaveBeenCalled();
    act(() => result.current.close());
    expect(result.current.draft).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the returned thread open after a send even if it was already selected', () => {
    const { result } = setup();
    act(() => result.current.openThread('saved'));
    act(() => result.current.openThread('saved', false));
    expect(result.current.threadId).toBe('saved');
    act(() => result.current.openThread('saved'));
    expect(result.current.threadId).toBeNull();
  });

  it.each([false, true])(
    'does not replace a newer thread preview or its dismissal after a slow main-feed reply (closed: %s)',
    (closed) => {
      const { result } = setup();
      const openAfterSend = result.current.openThread;
      act(() => result.current.openDraft(draft('new-selection')));
      if (closed) act(() => result.current.close());
      act(() => openAfterSend('sent-reply-thread', false));
      expect(result.current.draft?.root.id).toBe(closed ? undefined : 'new-selection');
      expect(result.current.threadId).toBeNull();
    },
  );

  it('sends once with the root and opens the saved thread only after success', async () => {
    const { result } = setup();
    act(() => result.current.openDraft(draft()));
    await act(async () => result.current.send('Hello', ['member'], 'request', ['file']));
    expect(send).toHaveBeenCalledExactlyOnceWith({
      channelId: 'channel',
      content: 'Hello',
      mentions: ['member'],
      requestKey: 'request',
      fileIds: ['file'],
      rootMessageId: 'root',
    });
    expect(result.current.draft).toBeNull();
    expect(result.current.threadId).toBe('saved');
  });

  it('keeps the preview after failure so the same first message can be retried', async () => {
    send.mockRejectedValueOnce(new Error('offline'));
    const { result } = setup();
    act(() => result.current.openDraft(draft()));
    await act(async () => {
      await expect(result.current.send('Hello', [], 'same-key')).rejects.toThrow('offline');
    });
    expect(result.current.draft?.root.id).toBe('root');
    expect(result.current.threadId).toBeNull();
    await act(async () => result.current.send('Hello', [], 'same-key'));
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(result.current.threadId).toBe('saved');
  });

  it.each(['close', 'other-draft', 'other-thread', 'scope', 'channel'] as const)(
    'does not replace a later selection after a slow send (%s)',
    async (change) => {
      const gate = Promise.withResolvers<{ threadId: string }>();
      send.mockReturnValue(gate.promise);
      const { result, rerender } = setup();
      act(() => result.current.openDraft(draft()));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.send('Hello', [], 'request');
      });
      act(() => {
        if (change === 'close') result.current.close();
        if (change === 'other-draft') result.current.openDraft(draft('other-root'));
        if (change === 'other-thread') result.current.openThread('other-thread');
        if (change === 'scope') identity.scope = 'two';
      });
      if (change === 'channel') rerender({ channelId: 'other-channel' });
      await act(async () => {
        gate.resolve({ threadId: 'saved' });
        await pending;
      });
      expect(result.current.threadId).toBe(change === 'other-thread' ? 'other-thread' : null);
      if (change === 'other-draft') expect(result.current.draft?.root.id).toBe('other-root');
    },
  );

  it('rejects sending a preview after the active identity changed', async () => {
    const { result } = setup();
    act(() => result.current.openDraft(draft()));
    identity.scope = 'two';
    await expect(result.current.send('Hello', [], 'request')).rejects.toThrow(
      'Channel draft changed',
    );
    expect(send).not.toHaveBeenCalled();
  });
});
