import type {
  ConversationContext,
  CreateMessageParams,
  UploadFileItem,
  VoiceMessageRecording,
} from '@lobechat/types';
import { generateEntityId } from '@lobechat/utils';
import { produce } from 'immer';
import type { StoreApi } from 'zustand';

import { fileService } from '@/services/file';
import { QUEUE_BLOCKING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getFileStoreState } from '@/store/file/store';
import type { StoreSetter } from '@/store/types';

import type { VoiceMessageUploadError, VoiceMessageUploadState } from './initialState';
import { VoiceMessageUploadOwnership } from './uploadOwnership';

export interface VoiceMessageSendOptions {
  context: ConversationContext;
  messageId: string;
  signal: AbortSignal;
}

export type VoiceMessageSend = (
  file: UploadFileItem,
  options: VoiceMessageSendOptions,
) => Promise<void>;

export interface SendVoiceMessageParams {
  canSend: (context: ConversationContext) => boolean;
  context: ConversationContext;
  recording: VoiceMessageRecording;
  send: VoiceMessageSend;
}

interface VoiceMessageTransaction extends SendVoiceMessageParams {
  abortController: AbortController;
  discardPromise?: Promise<void>;
  messageId: string;
  operationId: string;
  ownership: VoiceMessageUploadOwnership;
  predecessorOperationIds: string[];
  previewUrl: string;
  runPromise?: Promise<void>;
}

type Setter = StoreSetter<ChatStore>;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown voice message error';

export class VoiceMessageActionImpl {
  readonly #api: StoreApi<ChatStore>;
  readonly #get: () => ChatStore;
  readonly #set: Setter;
  readonly #transactions = new Map<string, VoiceMessageTransaction>();

  constructor(set: Setter, get: () => ChatStore, api: StoreApi<ChatStore>) {
    this.#api = api;
    this.#get = get;
    this.#set = set;
  }

  #createLocalMessage = (transaction: VoiceMessageTransaction): CreateMessageParams => ({
    agentId: transaction.context.agentId,
    audioList: [
      {
        alt: transaction.recording.file.name,
        codec: transaction.recording.codec,
        durationMs: transaction.recording.durationMs,
        id: `${transaction.messageId}_audio`,
        mimeType: transaction.recording.mimeType,
        url: transaction.previewUrl,
      },
    ],
    content: '',
    groupId: transaction.context.groupId,
    metadata: { scope: LOCAL_MESSAGE_SCOPE },
    role: 'user',
    threadId: transaction.context.threadId,
    topicId: transaction.context.topicId ?? undefined,
  });

  #deleteLocalMessage = (transaction: VoiceMessageTransaction) => {
    this.#get().internal_dispatchMessage(
      { id: transaction.messageId, type: 'deleteMessage' },
      { conversationContext: transaction.context },
    );
  };

  #deleteUploadState = (messageId: string) => {
    this.#set(
      (state) => {
        if (!state.voiceMessageUploadMap[messageId]) return state;

        const voiceMessageUploadMap = { ...state.voiceMessageUploadMap };
        delete voiceMessageUploadMap[messageId];
        return { voiceMessageUploadMap };
      },
      false,
      `voiceMessage/deleteUploadState/${messageId}`,
    );
  };

  #discardTransaction = (transaction: VoiceMessageTransaction): Promise<void> => {
    if (transaction.discardPromise) return transaction.discardPromise;
    if (this.#transactions.get(transaction.messageId) !== transaction) return Promise.resolve();

    const discardPromise = this.#performDiscardTransaction(transaction);
    transaction.discardPromise = discardPromise;
    return discardPromise;
  };

  #performDiscardTransaction = async (transaction: VoiceMessageTransaction) => {
    const uploadedFile = transaction.ownership.getPending();
    this.#transactions.delete(transaction.messageId);
    transaction.abortController.abort(
      new DOMException('Voice message upload was cancelled', 'AbortError'),
    );

    let discardOutcome: 'accepted' | 'discarded' = 'discarded';
    try {
      discardOutcome = await transaction.ownership.discard();
    } catch (error) {
      console.error('[VoiceMessage] Failed to discard an uploaded voice file:', error);
    }

    if (
      discardOutcome !== 'accepted' ||
      !uploadedFile ||
      this.#shouldDeleteAcceptedPreview(transaction, uploadedFile)
    ) {
      this.#deleteLocalMessage(transaction);
    }
    this.#deleteUploadState(transaction.messageId);
    URL.revokeObjectURL(transaction.previewUrl);
  };

  #ensureLocalMessage = (transaction: VoiceMessageTransaction) => {
    const messages = this.#get().dbMessagesMap[messageMapKey(transaction.context)] ?? [];
    if (messages.some((message) => message.id === transaction.messageId)) return;

    this.#get().internal_dispatchMessage(
      {
        id: transaction.messageId,
        type: 'createMessage',
        value: this.#createLocalMessage(transaction),
      },
      { conversationContext: transaction.context },
    );
  };

  #moveLocalMessage = (
    transaction: VoiceMessageTransaction,
    sourceContext: ConversationContext,
  ) => {
    const sourceKey = messageMapKey(sourceContext);
    const targetKey = messageMapKey(transaction.context);
    const sourceMessage = this.#get().dbMessagesMap[sourceKey]?.find(
      (message) => message.id === transaction.messageId,
    );
    if (!sourceMessage) return;

    const targetMessages = this.#get().dbMessagesMap[targetKey] ?? [];
    if (!targetMessages.some((message) => message.id === transaction.messageId)) {
      this.#get().replaceMessages(
        [
          ...targetMessages,
          {
            ...sourceMessage,
            agentId: transaction.context.agentId,
            groupId: transaction.context.groupId,
            threadId: transaction.context.threadId ?? undefined,
            topicId: transaction.context.topicId ?? undefined,
          },
        ],
        { action: 'voiceMessage/moveLocalMessage', context: transaction.context },
      );
    }

    this.#get().internal_dispatchMessage(
      { id: transaction.messageId, type: 'deleteMessage' },
      { conversationContext: sourceContext },
    );
  };

  #getBlockingOperationIds = (transaction: VoiceMessageTransaction) => {
    const contextKey = messageMapKey(transaction.context);
    const contextOperationIds = this.#get().operationsByContext[contextKey] ?? [];
    const ownIndex = contextOperationIds.indexOf(transaction.operationId);

    const contextBlockers = contextOperationIds.filter((operationId, index) => {
      if (operationId === transaction.operationId) return false;

      const operation = this.#get().operations[operationId];
      if (
        !operation ||
        operation.status !== 'running' ||
        !QUEUE_BLOCKING_OPERATION_TYPES.includes(operation.type)
      )
        return false;

      // A later recording must not make an earlier voice turn wait for it. Earlier voice uploads
      // do block, which gives multiple recordings FIFO semantics even when their upload speeds
      // differ.
      if (operation.type === 'uploadVoiceMessage' && ownIndex >= 0 && index > ownIndex)
        return false;

      return true;
    });

    const predecessorBlockers = transaction.predecessorOperationIds.filter((operationId) => {
      const operation = this.#get().operations[operationId];

      return (
        operation?.status === 'running' && QUEUE_BLOCKING_OPERATION_TYPES.includes(operation.type)
      );
    });

    return [...new Set([...predecessorBlockers, ...contextBlockers])];
  };

  #waitForTurn = (transaction: VoiceMessageTransaction) => {
    if (this.#getBlockingOperationIds(transaction).length === 0) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const { signal } = transaction.abortController;
      let settleScheduled = false;
      let unsubscribe = () => {};

      const cleanup = () => {
        unsubscribe();
        signal.removeEventListener('abort', check);
      };
      const rejectIfCancelled = () => {
        if (!this.#isCurrent(transaction) || signal.aborted) {
          cleanup();
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException('Voice message was cancelled', 'AbortError'),
          );
          return true;
        }

        return false;
      };

      const settle = () => {
        settleScheduled = false;
        if (rejectIfCancelled()) return;

        if (this.#getBlockingOperationIds(transaction).length === 0) {
          cleanup();
          resolve();
        }
      };

      const check = () => {
        if (rejectIfCancelled()) return;

        // Topic creation completes the parent operation immediately before starting the child
        // runtime. Recheck in a microtask so the voice turn cannot slip through that handoff gap.
        if (this.#getBlockingOperationIds(transaction).length === 0 && !settleScheduled) {
          settleScheduled = true;
          queueMicrotask(settle);
        }
      };

      unsubscribe = this.#api.subscribe(check);
      signal.addEventListener('abort', check, { once: true });
      check();
    });
  };

  #renewOperation = (transaction: VoiceMessageTransaction) => {
    const { abortController, operationId } = this.#get().startOperation({
      context: { ...transaction.context, messageId: transaction.messageId },
      label: 'Upload Voice Message',
      type: 'uploadVoiceMessage',
    });

    transaction.abortController = abortController;
    transaction.operationId = operationId;
    this.#get().onOperationCancel(operationId, () => this.#discardTransaction(transaction));
  };

  #failTransaction = (
    transaction: VoiceMessageTransaction,
    error: VoiceMessageUploadError,
    cause?: unknown,
  ) => {
    if (this.#transactions.get(transaction.messageId) !== transaction) return;

    // The formal send lifecycle adopts this row and removes it from its `finally` block when the
    // request fails. Restore the same local-only preview so upload/send failures remain playable
    // and retryable. Checking the captured conversation bucket prevents duplicate rows.
    this.#ensureLocalMessage(transaction);
    const current = this.#get().voiceMessageUploadMap[transaction.messageId];
    this.#setUploadState(transaction.messageId, {
      error,
      progress: current?.progress ?? 0,
      status: 'failed',
    });
    this.#get().failOperation(transaction.operationId, {
      message: cause ? getErrorMessage(cause) : `Voice message ${error}`,
      type: `voice_message_${error}`,
    });
  };

  #shouldDeleteAcceptedPreview = (
    transaction: VoiceMessageTransaction,
    uploadedFile: UploadFileItem,
  ) => {
    const messages = this.#get().dbMessagesMap[messageMapKey(transaction.context)] ?? [];
    const optimisticMessage = messages.find((message) => message.id === transaction.messageId);
    const wasAdoptedBySendLifecycle = optimisticMessage?.audioList?.some(
      (audio) => audio.id === uploadedFile.id,
    );
    const hasPersistedReplacement = messages.some(
      (message) =>
        message.id !== transaction.messageId &&
        (message.files?.includes(uploadedFile.id) ||
          message.audioList?.some((audio) => audio.id === uploadedFile.id)),
    );

    return !wasAdoptedBySendLifecycle || hasPersistedReplacement;
  };

  #finishTransaction = (transaction: VoiceMessageTransaction, uploadedFile: UploadFileItem) => {
    if (this.#transactions.get(transaction.messageId) !== transaction) return;

    this.#transactions.delete(transaction.messageId);
    // Queue acceptance never adopts the local row, so remove that preview immediately. A normal
    // send updates the row to the uploaded file first; keep it until the persisted server snapshot
    // arrives, unless that replacement is already in the bucket.
    if (this.#shouldDeleteAcceptedPreview(transaction, uploadedFile)) {
      this.#deleteLocalMessage(transaction);
    }
    this.#deleteUploadState(transaction.messageId);
    URL.revokeObjectURL(transaction.previewUrl);
    this.#get().completeOperation(transaction.operationId);
  };

  #isCurrent = (transaction: VoiceMessageTransaction) =>
    this.#transactions.get(transaction.messageId) === transaction;

  #executeTransaction = async (transaction: VoiceMessageTransaction) => {
    const attemptId = transaction.ownership.beginAttempt();
    let phase: VoiceMessageUploadError = 'upload';

    try {
      let uploadItem = transaction.ownership.getPending();
      if (!uploadItem) {
        this.#setUploadState(transaction.messageId, { progress: 0, status: 'uploading' });

        const result = await getFileStoreState().uploadWithProgress({
          abortController: transaction.abortController,
          file: transaction.recording.file,
          fileMetadata: {
            codec: transaction.recording.codec,
            durationMs: transaction.recording.durationMs,
            mimeType: transaction.recording.mimeType,
          },
          uploadId: transaction.messageId,
          onStatusUpdate: (event) => {
            if (
              event.type !== 'updateFile' ||
              !transaction.ownership.isCurrent(attemptId) ||
              !this.#isCurrent(transaction) ||
              !event.value.uploadState
            )
              return;

            this.#setUploadState(transaction.messageId, {
              progress: event.value.uploadState.progress,
              status: 'uploading',
            });
          },
        });

        if (!result) throw new Error('Voice message upload did not return a file');

        uploadItem = {
          audioMetadata: {
            codec: transaction.recording.codec,
            durationMs: transaction.recording.durationMs,
            mimeType: transaction.recording.mimeType,
          },
          file: transaction.recording.file,
          fileUrl: result.url,
          id: result.id,
          status: 'success',
        };

        if (!(await transaction.ownership.ownUploaded(attemptId, uploadItem))) return;
      }

      if (!this.#isCurrent(transaction) || transaction.abortController.signal.aborted) return;

      if (!transaction.canSend(transaction.context)) {
        this.#failTransaction(transaction, 'unsupported');
        return;
      }

      phase = 'send';
      this.#setUploadState(transaction.messageId, { progress: 100, status: 'sending' });

      // Keep the optimistic transcript and model input in the same order. The upload operation is
      // a queue barrier for later composer sends; this transaction waits for older turns and then
      // invokes the formal lifecycle, which ignores its own barrier.
      await this.#waitForTurn(transaction);

      if (!this.#isCurrent(transaction) || transaction.abortController.signal.aborted) return;
      if (!transaction.canSend(transaction.context)) {
        this.#failTransaction(transaction, 'unsupported');
        return;
      }

      const sendPromise = transaction.send(uploadItem, {
        context: transaction.context,
        messageId: transaction.messageId,
        signal: transaction.abortController.signal,
      });
      transaction.ownership.trackSend(uploadItem, sendPromise);
      try {
        await sendPromise;
        transaction.ownership.accept(uploadItem);
      } finally {
        transaction.ownership.finishSend(sendPromise);
      }

      this.#finishTransaction(transaction, uploadItem);
    } catch (error) {
      if (!this.#isCurrent(transaction) || transaction.abortController.signal.aborted) return;

      this.#failTransaction(transaction, phase, error);
    }
  };

  #runTransaction = (transaction: VoiceMessageTransaction) => {
    if (transaction.runPromise) return transaction.runPromise;

    const runPromise = this.#executeTransaction(transaction);
    transaction.runPromise = runPromise;
    void runPromise.then(
      () => {
        if (transaction.runPromise === runPromise) transaction.runPromise = undefined;
      },
      () => {
        if (transaction.runPromise === runPromise) transaction.runPromise = undefined;
      },
    );

    return runPromise;
  };

  #setUploadState = (messageId: string, value: VoiceMessageUploadState) => {
    if (!this.#transactions.has(messageId)) return;

    this.#set(
      (state) => ({
        voiceMessageUploadMap: { ...state.voiceMessageUploadMap, [messageId]: value },
      }),
      false,
      `voiceMessage/setUploadState/${messageId}/${value.status}`,
    );
  };

  cancelVoiceMessage = async (messageId: string) => {
    const transaction = this.#transactions.get(messageId);
    if (!transaction) return;

    const operation = this.#get().operations[transaction.operationId];
    if (operation && operation.status !== 'cancelled' && operation.status !== 'completed') {
      this.#get().cancelOperation(transaction.operationId, 'Voice message cancelled');
    }

    await this.#discardTransaction(transaction);
  };

  retryVoiceMessage = (messageId: string) => {
    const transaction = this.#transactions.get(messageId);
    const uploadState = this.#get().voiceMessageUploadMap[messageId];
    if (!transaction || transaction.runPromise || uploadState?.status !== 'failed') return;

    this.#renewOperation(transaction);
    this.#ensureLocalMessage(transaction);
    void this.#runTransaction(transaction);
  };

  disposeVoiceMessages = () => {
    const transactions = [...this.#transactions.values()];
    this.#transactions.clear();

    for (const transaction of transactions) {
      transaction.abortController.abort(new DOMException('Chat store was reset', 'AbortError'));
      URL.revokeObjectURL(transaction.previewUrl);
      void transaction.ownership.discard().catch((error) => {
        console.error('[VoiceMessage] Failed to clean up a voice file during reset:', error);
      });
    }
  };

  moveVoiceMessages = (sourceContext: ConversationContext, targetContext: ConversationContext) => {
    const sourceKey = messageMapKey(sourceContext);
    const targetKey = messageMapKey(targetContext);
    if (sourceKey === targetKey) return;

    const transactions = [...this.#transactions.values()].filter(
      (transaction) => messageMapKey(transaction.context) === sourceKey,
    );
    if (transactions.length === 0) return;

    for (const transaction of transactions) {
      transaction.context = { ...targetContext };
    }

    this.#set(
      produce((state: ChatStore) => {
        for (const transaction of transactions) {
          const operation = state.operations[transaction.operationId];
          if (!operation || operation.status !== 'running') continue;

          state.operationsByContext[sourceKey] = (
            state.operationsByContext[sourceKey] ?? []
          ).filter((operationId) => operationId !== transaction.operationId);
          const targetOperationIds = state.operationsByContext[targetKey] ?? [];
          if (!targetOperationIds.includes(transaction.operationId)) {
            state.operationsByContext[targetKey] = [...targetOperationIds, transaction.operationId];
          }
          operation.context = {
            ...targetContext,
            messageId: transaction.messageId,
          };
        }
      }),
      false,
      `voiceMessage/moveTransactions/${sourceKey}/${targetKey}`,
    );

    for (const transaction of transactions) {
      this.#moveLocalMessage(transaction, sourceContext);
    }
  };

  sendVoiceMessage = ({ canSend, context, recording, send }: SendVoiceMessageParams) => {
    if (!canSend(context)) return;

    // The server accepts caller-provided message ids and validates the canonical
    // `msg_*` entity shape. Reuse that final id from the first optimistic frame.
    const messageId = generateEntityId('messages');
    const previewUrl = URL.createObjectURL(recording.file);
    const predecessorOperationIds = (
      this.#get().operationsByContext[messageMapKey(context)] ?? []
    ).filter((operationId) => {
      const operation = this.#get().operations[operationId];

      return (
        operation?.status === 'running' && QUEUE_BLOCKING_OPERATION_TYPES.includes(operation.type)
      );
    });
    const { abortController, operationId } = this.#get().startOperation({
      context: { ...context, messageId },
      label: 'Upload Voice Message',
      type: 'uploadVoiceMessage',
    });
    const transaction: VoiceMessageTransaction = {
      abortController,
      canSend,
      context,
      messageId,
      operationId,
      ownership: new VoiceMessageUploadOwnership((id) => fileService.removeUnreferencedFile(id)),
      predecessorOperationIds,
      previewUrl,
      recording,
      send,
    };
    this.#transactions.set(messageId, transaction);
    this.#get().onOperationCancel(operationId, () => this.#discardTransaction(transaction));

    this.#ensureLocalMessage(transaction);
    this.#setUploadState(messageId, { progress: 0, status: 'uploading' });

    void this.#runTransaction(transaction);

    return messageId;
  };
}

export type VoiceMessageAction = Pick<VoiceMessageActionImpl, keyof VoiceMessageActionImpl>;
