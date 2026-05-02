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
