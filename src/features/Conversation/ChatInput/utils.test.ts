import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  getContextWindowMessages,
  getConversationChatInputUiState,
  toChatInputMessages,
} from './utils';

const tokenMessages = [
  { content: 'old user', id: 'msg-1', role: 'user' },
  { content: 'old assistant', id: 'msg-2', role: 'assistant' },
  { content: 'latest tool', id: 'msg-3', role: 'tool' },
  { content: 'latest user', id: 'msg-4', role: 'user' },
] as UIChatMessage[];

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

describe('getConversationChatInputUiState', () => {
  it('shows follow-up placeholder and stop button while loading with an empty composer', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: true,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'followUp',
      showSendMenu: false,
      showStopButton: true,
    });
  });

  it('keeps the stop button visible while the user types a follow-up during loading', () => {
    // Regression: flipping to Send the moment the composer had any text read
    // as "agent finished" and made queued sends look like fresh sends. Stop
    // must stay up for the whole loading window — Enter still enqueues, and
    // the QueueTray exposes Send-now per item.
    expect(
      getConversationChatInputUiState({
        isInputEmpty: false,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendMenu: false,
      showStopButton: true,
    });
  });

  it('keeps the default composer state when not loading', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: true,
        isInputLoading: false,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendMenu: true,
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
      showStopButton: true,
    });
  });
});
