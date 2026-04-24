import { describe, expect, it } from 'vitest';

import { getConversationChatInputUiState } from './utils';

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

  it('restores the send button once the user starts a follow-up during loading', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: false,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendMenu: false,
      showStopButton: false,
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
});
