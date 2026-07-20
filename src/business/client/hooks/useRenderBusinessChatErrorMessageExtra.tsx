import { type ChatMessageError } from '@lobechat/types';

export default function useRenderBusinessChatErrorMessageExtra(
  _error: ChatMessageError | null | undefined,
  _messageId: string,
) {
  return null;
}
