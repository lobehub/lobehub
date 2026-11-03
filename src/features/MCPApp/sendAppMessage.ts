import type { SendMessageParams } from '@lobechat/types';

import { toAppMessage } from './utils';

type SendMessage = (params: SendMessageParams) => Promise<void>;

/** A completed send is not acceptance: preflight or task creation can return without storing it. */
export const sendAppMessage = (
  sendMessage: SendMessage,
  text: string,
  identifier: string,
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    void sendMessage({
      ...toAppMessage(text, identifier),
      onMessageAccepted: () => resolve(true),
    }).then(() => resolve(false), reject);
  });
