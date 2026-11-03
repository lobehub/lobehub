import { describe, expect, it, vi } from 'vitest';

import { type ConversationHooks } from '../types';
import { mergeConversationHooks } from './mergeConversationHooks';

describe('mergeConversationHooks', () => {
  it('returns empty object when no hooks supplied', () => {
    expect(mergeConversationHooks()).toEqual({});
    expect(mergeConversationHooks(undefined)).toEqual({});
    expect(mergeConversationHooks(undefined, undefined)).toEqual({});
  });

  it('returns the single hook object when only one is defined', () => {
    const onMessageCopied = vi.fn();
    const merged = mergeConversationHooks({ onMessageCopied });
    expect(merged.onMessageCopied).toBe(onMessageCopied);
  });

  it('invokes hooks of disjoint members from both inputs', async () => {
    const onMessageCopied = vi.fn();
    const onAfterSendMessage = vi.fn();

    const merged = mergeConversationHooks({ onMessageCopied }, { onAfterSendMessage });

    merged.onMessageCopied?.('m-1');
    await merged.onAfterSendMessage?.();

    expect(onMessageCopied).toHaveBeenCalledWith('m-1');
    expect(onAfterSendMessage).toHaveBeenCalledTimes(1);
  });

  it('invokes both onAssistantTurnSettled handlers in order with same args', async () => {
    const order: string[] = [];
    const a = vi.fn(async () => {
      order.push('a');
    });
    const b = vi.fn(async () => {
      order.push('b');
    });

    const merged = mergeConversationHooks(
      { onAssistantTurnSettled: a },
      { onAssistantTurnSettled: b },
    );

    await merged.onAssistantTurnSettled?.('msg-1', { reason: 'completed' });

    expect(a).toHaveBeenCalledWith('msg-1', { reason: 'completed' });
    expect(b).toHaveBeenCalledWith('msg-1', { reason: 'completed' });
    expect(order).toEqual(['a', 'b']);
  });

  it('short-circuits onBeforeSendMessage chain on first false', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => false);
    const third = vi.fn(async () => undefined);

    const merged = mergeConversationHooks(
      { onBeforeSendMessage: first as ConversationHooks['onBeforeSendMessage'] },
      { onBeforeSendMessage: second as ConversationHooks['onBeforeSendMessage'] },
      { onBeforeSendMessage: third as ConversationHooks['onBeforeSendMessage'] },
    );

    const result = await merged.onBeforeSendMessage?.({ message: 'hi' } as any);

    expect(result).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
  });

  it('continues the chain when before-hooks return undefined / true', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => true);
    const third = vi.fn(async () => undefined);

    const merged = mergeConversationHooks(
      { onBeforeRegenerate: first as ConversationHooks['onBeforeRegenerate'] },
      { onBeforeRegenerate: second as ConversationHooks['onBeforeRegenerate'] },
      { onBeforeRegenerate: third as ConversationHooks['onBeforeRegenerate'] },
    );

    const result = await merged.onBeforeRegenerate?.('msg-1');

    expect(result).toBeUndefined();
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(third).toHaveBeenCalled();
  });

  it('skips undefined entries in the input array', async () => {
    const onAfterSendMessage = vi.fn();
    const merged = mergeConversationHooks(undefined, { onAfterSendMessage }, undefined);
    await merged.onAfterSendMessage?.();
    expect(onAfterSendMessage).toHaveBeenCalledTimes(1);
  });

  it('treats absent fields as no-ops without throwing', async () => {
    const merged = mergeConversationHooks({}, {});
    expect(merged.onAssistantTurnSettled).toBeUndefined();
    expect(merged.onBeforeSendMessage).toBeUndefined();
  });
});
