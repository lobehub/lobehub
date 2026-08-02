import { type SendMessageParams, type UploadFileItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { sendVoiceMessage } from './sendVoiceMessage';

const voiceFile = {
  id: 'voice-file',
  status: 'success',
} as UploadFileItem;

describe('sendVoiceMessage', () => {
  it('releases the recording after acceptance without waiting for generation to finish', async () => {
    let params: SendMessageParams | undefined;
    let resolveSend!: () => void;
    let sendFinished = false;
    const sendMessage = vi.fn((nextParams: SendMessageParams) => {
      params = nextParams;
      return new Promise<void>((resolve) => {
        resolveSend = () => {
          sendFinished = true;
          resolve();
        };
      });
    });

    const result = sendVoiceMessage(sendMessage, voiceFile);
    params?.onMessageAccepted?.();

    await expect(result).resolves.toBeUndefined();
    expect(sendFinished).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith({
      files: [voiceFile],
      message: '',
      onMessageAccepted: expect.any(Function),
      preserveComposer: true,
    });

    resolveSend();
  });

  it('keeps the recording available for retry when acceptance is not acknowledged', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await expect(sendVoiceMessage(sendMessage, voiceFile)).rejects.toThrow(
      'Voice message was not accepted',
    );
  });
});
