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
  const showFollowUpComposer = isInputLoading && isInputEmpty;

  return {
    placeholderVariant: showFollowUpComposer ? 'followUp' : 'default',
    showSendMenu: !isInputLoading,
    showStopButton: showFollowUpComposer,
  };
};
