import type { SendMessageParams } from '@lobechat/types';

import { toAppMessage } from './utils';

type SendMessage = (params: SendMessageParams) => Promise<void>;

/**
 * Post a view's message as its own turn. A completed send is not acceptance:
 * preflight or task creation can return without storing it.
 *
 * The composer is left alone: it may hold an unrelated draft, which a normal
 * send marks empty, and a failed send would refill it with the view's text.
 */
export const sendAppMessage = (
  sendMessage: SendMessage,
  text: string,
  identifier: string,
  /**
   * Cancels the send until the conversation accepts the message; once it has,
   * the run belongs to the conversation and is stopped from there.
   */
  signal?: AbortSignal,
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    void sendMessage({
      ...toAppMessage(text, identifier),
      onMessageAccepted: () => resolve(true),
      preserveComposer: true,
      ...(signal && { signal }),
    }).then(() => resolve(false), reject);
  });
