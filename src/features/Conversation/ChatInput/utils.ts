import { type PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';

export interface ConversationChatInputUiState {
  placeholderVariant: PlaceholderVariant;
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
    showStopButton: showFollowUpComposer,
  };
};
