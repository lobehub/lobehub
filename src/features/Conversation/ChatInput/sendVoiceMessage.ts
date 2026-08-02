import { type SendMessageParams, type UploadFileItem } from '@lobechat/types';

type SendMessage = (params: SendMessageParams) => Promise<void>;

/**
 * Dispatch an audio-only turn and retain the recording until the conversation lifecycle owns it
 * as either a persisted user message or a queued turn.
 */
export const sendVoiceMessage = (sendMessage: SendMessage, file: UploadFileItem) =>
  new Promise<void>((resolve, reject) => {
    let accepted = false;

    void sendMessage({
      files: [file],
      message: '',
      onMessageAccepted: () => {
        accepted = true;
        resolve();
      },
      preserveComposer: true,
    }).then(() => {
      if (!accepted) reject(new Error('Voice message was not accepted'));
    }, reject);
  });
