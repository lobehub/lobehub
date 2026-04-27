import { type PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';

export interface ConversationChatInputUiState {
  placeholderVariant: PlaceholderVariant;
  showSendMenu: boolean;
  showStopButton: boolean;
}

export interface GetConversationChatInputUiStateParams {
  isInputEmpty: boolean;
  isInputLoading: boolean;
}

export const getConversationChatInputUiState = ({
  isInputEmpty,
  isInputLoading,
}: GetConversationChatInputUiStateParams): ConversationChatInputUiState => {
  // Keep the Stop button up for the entire loading window — including when the
  // user starts typing a follow-up. Previously this flipped to Send the moment
  // the composer had any text, which read as "agent finished" and made queued
  // sends look like fresh sends. Pressing Enter still enqueues; the QueueTray
  // exposes per-item Send-now and Edit/Delete for explicit control.
  return {
    placeholderVariant: isInputLoading && isInputEmpty ? 'followUp' : 'default',
    showSendMenu: !isInputLoading,
    showStopButton: isInputLoading,
  };
};
