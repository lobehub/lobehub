import { type ChatMessageError } from '@lobechat/types';

interface BusinessChatErrorMessageExtraOptions {
  /**
   * Retry for the failed turn, resolved by the render surface. Business cards
   * must use it instead of deriving a retry from `messageId`: on the group
   * surface (a multi-step run) `messageId` is a nested content block, which the
   * message-level store actions cannot resolve.
   */
  onRetry?: () => void;
}

export default function useRenderBusinessChatErrorMessageExtra(
  _error: ChatMessageError | null | undefined,
  _messageId: string,
  _options?: BusinessChatErrorMessageExtraOptions,
) {
  return null;
}
