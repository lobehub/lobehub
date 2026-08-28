import { type SendMessageParams, type UploadFileItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { sendVoiceMessage } from './sendVoiceMessage';

const voiceFile = {
  id: 'voice-file',
  status: 'success',
} as UploadFileItem;

describe('sendVoiceMessage', () => {
  it('forwards the optimistic user message id to the formal send lifecycle', async () => {
    const context = { agentId: 'agent-1', topicId: 'topic-created' };
    const sendMessage = vi.fn(async (params: SendMessageParams) => {
      params.onMessageAccepted?.();
    });

    await expect(
      sendVoiceMessage(sendMessage, voiceFile, {
        context,
        optimisticUserMessageId: 'tmp-voice-message',
      }),
    ).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: context,
        optimisticUserMessageId: 'tmp-voice-message',
      }),
    );
  });

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

  it('lets acceptance win when cancellation races with the underlying send completion', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    let params: SendMessageParams | undefined;
    let rejectSend!: (reason: unknown) => void;
    const sendMessage = vi.fn((nextParams: SendMessageParams) => {
      params = nextParams;
      return new Promise<void>((_, reject) => {
        rejectSend = reject;
      });
    });

    const result = sendVoiceMessage(sendMessage, voiceFile, { signal: controller.signal });
    expect(params?.signal).toBe(controller.signal);

    params?.onMessageAccepted?.();
    controller.abort(abortError);
    rejectSend(abortError);

    await expect(result).resolves.toBeUndefined();
  });

  it('waits for an unaccepted send to settle before reporting cancellation', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    let resolveSend!: () => void;
    const sendMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const settled = vi.fn();

    const result = sendVoiceMessage(sendMessage, voiceFile, { signal: controller.signal });
    void result.then(settled, settled);
    controller.abort(abortError);
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();

    resolveSend();
    await expect(result).rejects.toBe(abortError);
  });

  it('does not dispatch a pre-cancelled recording', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    const sendMessage = vi.fn();
    controller.abort(abortError);

    await expect(
      sendVoiceMessage(sendMessage, voiceFile, { signal: controller.signal }),
    ).rejects.toBe(abortError);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the recording available for retry when acceptance is not acknowledged', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await expect(sendVoiceMessage(sendMessage, voiceFile)).rejects.toThrow(
      'Voice message was not accepted',
    );
  });
});
