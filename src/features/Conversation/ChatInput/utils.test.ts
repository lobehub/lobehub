import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  createQueueSendNowGate,
  getContextWindowMessages,
  getConversationChatInputUiState,
  getConversationSendButtonProps,
  toChatInputMessages,
} from './utils';

const tokenMessages = [
  { content: 'old user', id: 'msg-1', role: 'user' },
  { content: 'old assistant', id: 'msg-2', role: 'assistant' },
  { content: 'latest tool', id: 'msg-3', role: 'tool' },
  { content: 'latest user', id: 'msg-4', role: 'user' },
] as UIChatMessage[];

describe('createQueueSendNowGate', () => {
  /**
   * @example Two different queued rows are clicked before the first writer exits.
   */
  it('rejects an overlapping row while the first send-now task is settling', async () => {
    // ROOT CAUSE:
    //
    // QueueTray previously keyed its in-flight guard by message id. Clicking a
    // second row after the first cancellation marked the blocker as cancelled
    // could therefore dispatch another turn while the native writer still exited.
    //
    // Before: each queued message owned an independent in-flight flag.
    // After: the conversation tray owns one gate across all queued messages.
    const gate = createQueueSendNowGate();
    let releaseFirst!: () => void;
    const firstTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const secondTask = vi.fn(async () => {});

    const first = gate.run(firstTask);
    const second = gate.run(secondTask);

    await expect(second).resolves.toBe(false);
    expect(secondTask).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe(true);
    await expect(gate.run(secondTask)).resolves.toBe(true);
    expect(secondTask).toHaveBeenCalledTimes(1);
  });
});

describe('toChatInputMessages', () => {
  it('preserves user, assistant, and tool messages with their real roles', () => {
    expect(toChatInputMessages(tokenMessages).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ]);
  });

  it('filters out unsupported roles (e.g. system or custom roles)', () => {
    const mixedMessages = [
      { content: 'system message', id: 'msg-0', role: 'system' },
      { content: 'user message', id: 'msg-1', role: 'user' },
      { content: 'assistant message', id: 'msg-2', role: 'assistant' },
      { content: 'tool message', id: 'msg-3', role: 'tool' },
    ] as any[];

    expect(toChatInputMessages(mixedMessages)).toEqual([
      { content: 'user message', role: 'user' },
      { content: 'assistant message', role: 'assistant' },
      { content: 'tool message', role: 'tool' },
    ]);
  });

  it('coerces non-string content to an empty string', () => {
    const invalidContentMessages = [
      { content: undefined, id: 'msg-1', role: 'user' },
      { content: null, id: 'msg-2', role: 'assistant' },
      { content: ['array content'], id: 'msg-3', role: 'tool' },
      { content: { text: 'object content' }, id: 'msg-4', role: 'user' },
    ] as any[];

    expect(toChatInputMessages(invalidContentMessages)).toEqual([
      { content: '', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '', role: 'tool' },
      { content: '', role: 'user' },
    ]);
  });
});

describe('getContextWindowMessages', () => {
  it('uses the full conversation when history count is disabled', () => {
    expect(
      getContextWindowMessages(tokenMessages, {
        enableHistoryCount: false,
        historyCount: 2,
      }).map((message) => message.content),
    ).toEqual(['old user', 'old assistant', 'latest tool', 'latest user']);
  });

  it('slices chat messages according to history count', () => {
    expect(
      getContextWindowMessages(tokenMessages, {
        enableHistoryCount: true,
        historyCount: 2,
      }).map((message) => message.content),
    ).toEqual(['latest tool', 'latest user']);
  });

  it('returns no historical chat messages when history count is zero', () => {
    expect(
      getContextWindowMessages(tokenMessages, {
        enableHistoryCount: true,
        historyCount: 0,
      }),
    ).toEqual([]);
  });
});

describe('getConversationSendButtonProps', () => {
  it.each([false, true])(
    'keeps uploads disabled with generating=%s despite a host override',
    (generating) => {
      const defaults = {
        disabled: true,
        generating,
        onStop: vi.fn(),
        showSendWhileGenerating: generating,
      };
      const overrides = { disabled: false, shape: 'round' as const };

      expect(getConversationSendButtonProps(defaults, overrides, true)).toEqual({
        ...defaults,
        disabled: true,
        shape: 'round',
      });
      expect(getConversationSendButtonProps(defaults, overrides, false).disabled).toBe(false);
    },
  );

  it.each([
    { customDisabled: undefined, disabled: true, expected: true },
    { customDisabled: undefined, disabled: false, expected: false },
    { customDisabled: true, disabled: false, expected: true },
    { customDisabled: false, disabled: true, expected: false },
  ])(
    'preserves non-upload disabled overrides: $customDisabled / $disabled',
    ({ customDisabled, disabled, expected }) => {
      expect(
        getConversationSendButtonProps(
          { disabled, generating: false, onStop: vi.fn() },
          customDisabled === undefined ? undefined : { disabled: customDisabled },
          false,
        ).disabled,
      ).toBe(expected);
    },
  );
});

describe('getConversationChatInputUiState', () => {
  it('shows follow-up placeholder and only the stop button while loading with an empty composer', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: true,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'followUp',
      showSendMenu: false,
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });

  it('shows Send beside Stop while the user types a follow-up during loading', () => {
    // Regression: flipping Stop to Send the moment the composer had any text
    // read as "agent finished". Stop must stay up for the whole loading window;
    // Send appears next to it so the follow-up can be queued by click as well
    // as by Enter.
    expect(
      getConversationChatInputUiState({
        isInputEmpty: false,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendMenu: false,
      showSendWhileGenerating: true,
      showStopButton: true,
    });
  });

  it('keeps only Stop while loading when the host disables queueing', () => {
    expect(
      getConversationChatInputUiState({
        disableQueue: true,
        isInputEmpty: false,
        isInputLoading: true,
      }),
    ).toMatchObject({
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });

  it('keeps the default composer state when not loading', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: false,
        isInputLoading: false,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendMenu: true,
      showSendWhileGenerating: false,
      showStopButton: false,
    });
  });

  it('forces the default placeholder when disableFollowUpVariant is set, even while loading', () => {
    expect(
      getConversationChatInputUiState({
        disableFollowUpVariant: true,
        isInputEmpty: true,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendMenu: false,
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });
});
