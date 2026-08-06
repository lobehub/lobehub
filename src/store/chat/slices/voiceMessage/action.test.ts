import type { ConversationContext, UploadFileItem, VoiceMessageRecording } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat/store';
import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file/store';

import type { SendVoiceMessageParams, VoiceMessageSend, VoiceMessageSendOptions } from './action';

const context = { agentId: 'agent-voice', topicId: 'topic-voice' };
const messagesKey = messageMapKey(context);
const previewUrl = 'blob:voice-preview';
const uploadedResult = { id: 'file-voice', url: 'https://files.test/voice.webm' };

const deferred = <T = void>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });

  return { promise, reject, resolve };
};

const createRecording = (): VoiceMessageRecording => {
  const mimeType = 'audio/webm;codecs=opus';

  return {
    codec: 'opus',
    durationMs: 2400,
    file: new File(['voice'], 'voice.webm', { type: mimeType }),
    mimeType,
    waveform: [0.1, 0.5, 0.2],
  };
};

const getMessage = (messageId: string) =>
  useChatStore.getState().dbMessagesMap[messagesKey]?.find((message) => message.id === messageId);

const adoptUploadedFile = (
  file: UploadFileItem,
  messageId: string,
  conversationContext: ConversationContext = context,
) => {
  useChatStore.getState().internal_dispatchMessage(
    {
      id: messageId,
      type: 'updateMessage',
      value: {
        audioList: [
          {
            ...file.audioMetadata,
            alt: file.file.name,
            id: file.id,
            url: file.fileUrl!,
          },
        ],
      },
    },
    { conversationContext },
  );
};

let createdMessageIds: string[] = [];

const startVoiceMessage = ({
  canSend = () => true,
  context: transactionContext = context,
  recording = createRecording(),
  send,
}: Pick<SendVoiceMessageParams, 'send'> & Partial<SendVoiceMessageParams>) => {
  let messageId: string | undefined;

  act(() => {
    messageId = useChatStore.getState().sendVoiceMessage({
      canSend,
      context: transactionContext,
      recording,
      send,
    });
  });

  if (!messageId) throw new Error('Expected voice message to start');
  createdMessageIds.push(messageId);
  return messageId;
};

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.getState().reset();
  useFileStore.getState().reset();
  useChatStore.setState({
    activeAgentId: context.agentId,
    activeTopicId: context.topicId,
    dbMessagesMap: {},
    messagesMap: {},
    voiceMessageUploadMap: {},
  });
  createdMessageIds = [];

  vi.spyOn(URL, 'createObjectURL').mockReturnValue(previewUrl);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(fileService, 'removeUnreferencedFile').mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const messageId of createdMessageIds) {
    await useChatStore.getState().cancelVoiceMessage(messageId);
  }

  vi.restoreAllMocks();
});

describe('VoiceMessageAction', () => {
  it('inserts a local blob audio row immediately and reflects upload progress', async () => {
    const upload = deferred<typeof uploadedResult>();
    let reportProgress: ((progress: number) => void) | undefined;
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockImplementation(
      async ({ onStatusUpdate, uploadId }) => {
        reportProgress = (progress) =>
          onStatusUpdate?.({
            id: uploadId!,
            type: 'updateFile',
            value: { uploadState: { progress, restTime: 1, speed: 2 } },
          });
        return upload.promise;
      },
    );

    const messageId = startVoiceMessage({ send: vi.fn() });
    const message = getMessage(messageId);

    expect(message).toMatchObject({
      audioList: [
        {
          codec: 'opus',
          durationMs: 2400,
          mimeType: 'audio/webm;codecs=opus',
          url: previewUrl,
        },
      ],
      id: messageId,
      metadata: { scope: LOCAL_MESSAGE_SCOPE },
      role: 'user',
    });
    expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toEqual({
      progress: 0,
      status: 'uploading',
    });

    act(() => reportProgress?.(46));

    expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toEqual({
      progress: 46,
      status: 'uploading',
    });
  });

  it('keeps a successful optimistic row when the send lifecycle adopted the uploaded audio', async () => {
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue(uploadedResult);
    const send = vi.fn<VoiceMessageSend>(async (file, { messageId }) => {
      adoptUploadedFile(file, messageId);
    });

    const messageId = startVoiceMessage({ send });

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toBeUndefined(),
    );

    expect(getMessage(messageId)?.audioList?.[0]).toMatchObject({
      id: uploadedResult.id,
      url: uploadedResult.url,
    });
  });

  it('removes a successful local row when queue-like acceptance did not adopt it', async () => {
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue(uploadedResult);
    const send = vi.fn<VoiceMessageSend>().mockResolvedValue(undefined);

    const messageId = startVoiceMessage({ send });

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await waitFor(() => expect(getMessage(messageId)).toBeUndefined());
    expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toBeUndefined();
  });

  it('keeps the same local row after upload failure and retries with the same message id', async () => {
    const upload = vi
      .spyOn(useFileStore.getState(), 'uploadWithProgress')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(uploadedResult);
    const send = vi.fn<VoiceMessageSend>(async (file, { messageId }) => {
      adoptUploadedFile(file, messageId);
    });

    const messageId = startVoiceMessage({ send });

    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toMatchObject({
        error: 'upload',
        status: 'failed',
      }),
    );
    expect(getMessage(messageId)).toMatchObject({ id: messageId });

    act(() => useChatStore.getState().retryVoiceMessage(messageId));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(([params]) => params.uploadId)).toEqual([messageId, messageId]);
    expect(getMessage(messageId)?.audioList?.[0].id).toBe(uploadedResult.id);
  });

  it('restores one playable local row when the send lifecycle deletes it before failing', async () => {
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue(uploadedResult);
    const send = vi.fn<VoiceMessageSend>(async (_file, { messageId }) => {
      useChatStore.getState().internal_dispatchMessage({ id: messageId, type: 'deleteMessage' });
      throw new Error('send failed');
    });

    const messageId = startVoiceMessage({ send });

    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toMatchObject({
        error: 'send',
        status: 'failed',
      }),
    );

    const matchingMessages =
      useChatStore
        .getState()
        .dbMessagesMap[messagesKey]?.filter((message) => message.id === messageId) ?? [];
    expect(matchingMessages).toHaveLength(1);
    expect(matchingMessages[0].audioList?.[0].url).toBe(previewUrl);
    expect(matchingMessages[0].metadata?.scope).toBe(LOCAL_MESSAGE_SCOPE);
  });

  it('deletes the preview and unreferenced upload when cancellation wins an in-flight send', async () => {
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue(uploadedResult);
    const sendResult = deferred();
    let sendSignal: AbortSignal | undefined;
    const send = vi.fn<VoiceMessageSend>((_file, { signal }) => {
      sendSignal = signal;
      return sendResult.promise;
    });
    const removeFile = vi.mocked(fileService.removeUnreferencedFile);

    const messageId = startVoiceMessage({ send });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());

    const cancellation = useChatStore.getState().cancelVoiceMessage(messageId);
    sendResult.reject(new Error('not accepted'));
    await cancellation;

    expect(sendSignal?.aborted).toBe(true);
    expect(getMessage(messageId)).toBeUndefined();
    expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previewUrl);
    expect(removeFile).toHaveBeenCalledOnce();
    expect(removeFile).toHaveBeenCalledWith(uploadedResult.id);
  });

  it('keeps an adopted row and referenced upload when acceptance wins cancellation', async () => {
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue(uploadedResult);
    const sendResult = deferred();
    let uploadedFile: UploadFileItem | undefined;
    const send = vi.fn<VoiceMessageSend>((file) => {
      uploadedFile = file;
      return sendResult.promise;
    });
    const removeFile = vi.mocked(fileService.removeUnreferencedFile);

    const messageId = startVoiceMessage({ send });
    await waitFor(() => expect(uploadedFile).toBeDefined());
    act(() => adoptUploadedFile(uploadedFile!, messageId));

    const cancellation = useChatStore.getState().cancelVoiceMessage(messageId);
    sendResult.resolve();
    await cancellation;

    expect(getMessage(messageId)?.audioList?.[0]).toMatchObject({
      id: uploadedResult.id,
      url: uploadedResult.url,
    });
    expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toBeUndefined();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('runs only one upload when retry is triggered twice', async () => {
    const retryUpload = deferred<typeof uploadedResult>();
    const upload = vi
      .spyOn(useFileStore.getState(), 'uploadWithProgress')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockImplementationOnce(() => retryUpload.promise);
    const send = vi.fn<VoiceMessageSend>().mockResolvedValue(undefined);

    const messageId = startVoiceMessage({ send });
    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]?.status).toBe('failed'),
    );

    act(() => {
      useChatStore.getState().retryVoiceMessage(messageId);
      useChatStore.getState().retryVoiceMessage(messageId);
    });

    expect(upload).toHaveBeenCalledTimes(2);
    retryUpload.resolve(uploadedResult);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('keeps voice sends in creation order when a later upload finishes first', async () => {
    const firstUpload = deferred<typeof uploadedResult>();
    const secondUpload = deferred<typeof uploadedResult>();
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress')
      .mockImplementationOnce(() => firstUpload.promise)
      .mockImplementationOnce(() => secondUpload.promise);
    const sendOrder: string[] = [];
    const firstSend = vi.fn<VoiceMessageSend>(async (file, { messageId }) => {
      sendOrder.push('first');
      adoptUploadedFile(file, messageId);
    });
    const secondSend = vi.fn<VoiceMessageSend>(async (file, { messageId }) => {
      sendOrder.push('second');
      adoptUploadedFile(file, messageId);
    });

    startVoiceMessage({ send: firstSend });
    startVoiceMessage({ send: secondSend });

    secondUpload.resolve({ id: 'file-second', url: 'https://files.test/second.webm' });
    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap).toEqual(
        expect.objectContaining({
          [createdMessageIds[1]]: expect.objectContaining({ status: 'sending' }),
        }),
      ),
    );
    expect(secondSend).not.toHaveBeenCalled();

    firstUpload.resolve({ id: 'file-first', url: 'https://files.test/first.webm' });

    await waitFor(() => expect(secondSend).toHaveBeenCalledOnce());
    expect(firstSend).toHaveBeenCalledOnce();
    expect(sendOrder).toEqual(['first', 'second']);
  });

  it('moves a waiting voice turn to the created topic without overtaking its predecessor', async () => {
    const sourceContext = { agentId: context.agentId, threadId: null, topicId: null };
    const targetContext = {
      ...sourceContext,
      isNew: false,
      topicId: 'topic-created-from-first-turn',
    };
    const sourceKey = messageMapKey(sourceContext);
    const targetKey = messageMapKey(targetContext);
    const { operationId: predecessorOperationId } = useChatStore.getState().startOperation({
      context: sourceContext,
      type: 'sendMessage',
    });
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue(uploadedResult);
    const canSend = vi.fn(() => true);
    const send = vi.fn<VoiceMessageSend>(async (file, options: VoiceMessageSendOptions) =>
      adoptUploadedFile(file, options.messageId, options.context),
    );

    const messageId = startVoiceMessage({ canSend, context: sourceContext, send });
    const uploadOperationId = useChatStore.getState().operationsByMessage[messageId]?.at(-1);
    if (!uploadOperationId) throw new Error('Expected voice upload operation');

    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]?.status).toBe('sending'),
    );
    expect(send).not.toHaveBeenCalled();

    act(() => useChatStore.getState().moveVoiceMessages(sourceContext, targetContext));

    expect(
      useChatStore.getState().dbMessagesMap[sourceKey]?.find((message) => message.id === messageId),
    ).toBeUndefined();
    expect(
      useChatStore.getState().dbMessagesMap[targetKey]?.find((message) => message.id === messageId),
    ).toMatchObject({ id: messageId, topicId: targetContext.topicId });
    expect(useChatStore.getState().operationsByContext[sourceKey]).not.toContain(uploadOperationId);
    expect(useChatStore.getState().operationsByContext[targetKey]).toContain(uploadOperationId);
    expect(useChatStore.getState().operations[uploadOperationId].context).toMatchObject(
      targetContext,
    );
    expect(send).not.toHaveBeenCalled();

    let runtimeOperationId = '';
    act(() => {
      runtimeOperationId = useChatStore.getState().startOperation({
        context: targetContext,
        parentOperationId: predecessorOperationId,
        type: 'execAgentRuntime',
      }).operationId;
      useChatStore.getState().completeOperation(predecessorOperationId);
    });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    act(() => useChatStore.getState().completeOperation(runtimeOperationId));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: targetContext, messageId }),
    );
    expect(canSend).toHaveBeenLastCalledWith(targetContext);
  });

  it('rechecks the current capability when retrying a long-lived transaction', async () => {
    let supported = true;
    const canSend = vi.fn(() => supported);
    const upload = vi
      .spyOn(useFileStore.getState(), 'uploadWithProgress')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(uploadedResult);
    const send = vi.fn<VoiceMessageSend>(async (file, { messageId }) => {
      adoptUploadedFile(file, messageId);
    });
    const messageId = startVoiceMessage({ canSend, send });

    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]?.error).toBe('upload'),
    );

    supported = false;
    act(() => useChatStore.getState().retryVoiceMessage(messageId));
    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toMatchObject({
        error: 'unsupported',
        status: 'failed',
      }),
    );
    expect(send).not.toHaveBeenCalled();

    supported = true;
    act(() => useChatStore.getState().retryVoiceMessage(messageId));

    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledTimes(2);
    expect(canSend).toHaveBeenLastCalledWith(context);
  });

  it('aborts and disposes private voice transactions before resetting the chat store', async () => {
    const upload = deferred<typeof uploadedResult>();
    let uploadSignal: AbortSignal | undefined;
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockImplementation(
      ({ abortController }) => {
        if (!abortController) throw new Error('Expected upload abort controller');
        uploadSignal = abortController.signal;
        return upload.promise;
      },
    );
    const send = vi.fn<VoiceMessageSend>().mockResolvedValue(undefined);
    const removeFile = vi.mocked(fileService.removeUnreferencedFile);

    const messageId = startVoiceMessage({ send });

    act(() => useChatStore.getState().reset());

    expect(uploadSignal?.aborted).toBe(true);
    expect(useChatStore.getState().voiceMessageUploadMap).toEqual({});
    expect(useChatStore.getState().dbMessagesMap[messagesKey]).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previewUrl);

    upload.resolve(uploadedResult);

    await waitFor(() => expect(removeFile).toHaveBeenCalledWith(uploadedResult.id));
    expect(send).not.toHaveBeenCalled();
    expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toBeUndefined();
  });

  it('retries with a fresh operation and the captured context after the failed operation is GCd', async () => {
    const retryUpload = deferred<typeof uploadedResult>();
    vi.spyOn(useFileStore.getState(), 'uploadWithProgress')
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockImplementationOnce(() => retryUpload.promise);
    const send = vi.fn<VoiceMessageSend>().mockResolvedValue(undefined);
    const messageId = startVoiceMessage({ send });

    await waitFor(() =>
      expect(useChatStore.getState().voiceMessageUploadMap[messageId]?.status).toBe('failed'),
    );
    const failedOperationId = useChatStore.getState().operationsByMessage[messageId][0];
    const failedOperation = useChatStore.getState().operations[failedOperationId];

    act(() => {
      useChatStore.setState({
        activeAgentId: 'other-agent',
        activeTopicId: 'other-topic',
        operations: {
          ...useChatStore.getState().operations,
          [failedOperationId]: {
            ...failedOperation,
            metadata: { ...failedOperation.metadata, endTime: Date.now() - 60_000 },
          },
        },
      });
      useChatStore.getState().cleanupCompletedOperations(30_000);
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: messageId, type: 'deleteMessage' },
          { conversationContext: context },
        );
      useChatStore.getState().retryVoiceMessage(messageId);
    });

    const retryOperationId = useChatStore.getState().operationsByMessage[messageId]?.at(-1);
    expect(retryOperationId).toBeDefined();
    expect(retryOperationId).not.toBe(failedOperationId);
    expect(useChatStore.getState().operations[retryOperationId!].context).toMatchObject(context);
    expect(getMessage(messageId)).toMatchObject({ id: messageId });
    expect(
      useChatStore.getState().dbMessagesMap[
        messageMapKey({
          agentId: 'other-agent',
          topicId: 'other-topic',
        })
      ],
    ).toBeUndefined();

    await useChatStore.getState().cancelVoiceMessage(messageId);
    expect(getMessage(messageId)).toBeUndefined();
  });
});
