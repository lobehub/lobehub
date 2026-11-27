import type { ConversationContext, UploadFileItem } from '@lobechat/types';
import { generateEntityId } from '@lobechat/utils';

import { getOptimisticMessageMedia } from '@/store/chat/slices/agentRun/actions/entries/conversationLifecycle/optimisticMessageMedia';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import {
  isSendableQueuedMessage,
  isServerDeliveringQueuedMessage,
  mergeQueuedMessages,
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
  SEND_NOW_CANCEL_REASON,
} from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { isLocalOnlyMessage, LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';

export interface SendQueuedMessagesNowParams {
  context: ConversationContext;
  contextKey: string;
  getChat: () => ChatStore;
  /** The queued messages to send, merged into one message. */
  msgs: QueuedMessage[];
  /**
   * Also take what was queued while the run was stopping, so it goes in the
   * same message instead of waiting behind (and interrupting) the new turn.
   */
  takeArrivals?: boolean;
  /** Throws when the server cannot be asked; `false` means the run has it. */
  withdraw: (msg: QueuedMessage) => Promise<boolean>;
}

/** A queued message still waiting to be sent: not on its way into a run. */
export const isWaitingQueuedMessage = (msg: QueuedMessage): boolean =>
  isSendableQueuedMessage(msg) && !isServerDeliveringQueuedMessage(msg) && !msg.localSteer;

const toUploadFiles = (msg: Pick<QueuedMessage, 'files' | 'filesPreview'>) =>
  msg.filesPreview?.length
    ? reconstructUploadFilesFromQueue(msg.filesPreview)
    : msg.files?.length
      ? (msg.files.map((id) => ({ id })) as UploadFileItem[])
      : undefined;

/** One message carrying what was taken; a single one is sent as it is. */
const combine = (taken: QueuedMessage[]): Omit<QueuedMessage, 'createdAt' | 'interruptMode'> => {
  if (taken.length === 1) return taken[0];
  const merged = mergeQueuedMessages(taken);
  return { ...merged, id: taken[0].id };
};

/**
 * Send queued messages now: take them out of the queue, stop every run they
 * wait behind, then send them as one steered turn.
 *
 * Withdrawn first: interrupting a run that already wrote one into the
 * conversation would leave that copy unanswered. One the run took but has not
 * written yet (a CLI agent only reads it between its own turns) still
 * interrupts: the stop returns it to this tab, and it is withdrawn again and
 * sent. Should the interrupt fail, what was withdrawn goes back to the tray at
 * its own place, held by this client only.
 *
 * @returns `'delivered'` when the run already has all of them, so nothing was sent
 */
export const sendQueuedMessagesNow = async ({
  context,
  contextKey,
  getChat,
  msgs,
  takeArrivals,
  withdraw,
}: SendQueuedMessagesNowParams): Promise<'delivered' | 'sent'> => {
  const chat = getChat();
  const messageContext = { conversationContext: context };
  const queueOf = () => getChat().queuedMessages[contextKey] ?? [];
  const indexes = new Map(
    msgs.map((msg) => [msg.id, queueOf().findIndex((queued) => queued.id === msg.id)]),
  );
  const runningOpIds = operationSelectors.getRunningQueueBlockingOperationIds(context)(chat);
  /** Withdrawn: what this send carries. */
  const taken: QueuedMessage[] = [];
  let optimisticUserMessageId: string | undefined;
  let bubbleFor: QueuedMessage[] = [];
  let accepted = false;
  let persisted = false;

  /** @returns the ones the run took but has not written yet (still in the tray) */
  const takeBack = async (list: QueuedMessage[]) => {
    const held: QueuedMessage[] = [];
    for (const msg of list) {
      if (await withdraw(msg)) taken.push(msg);
      else if (queueOf().some((queued) => queued.id === msg.id)) held.push(msg);
    }
    return held;
  };

  const removeBubble = () => {
    if (!optimisticUserMessageId) return;
    const preview = getChat().dbMessagesMap[contextKey]?.find(
      (message) => message.id === optimisticUserMessageId,
    );
    if (isLocalOnlyMessage(preview))
      chat.internal_dispatchMessage(
        { id: optimisticUserMessageId, type: 'deleteMessage' },
        messageContext,
      );
    optimisticUserMessageId = undefined;
  };

  /** Show what goes in at once: stopping a CLI agent can take seconds. */
  const showPendingBubble = () => {
    if (!context.topicId || context.isNew || taken.length === 0) return;
    if (bubbleFor.length === taken.length) return;
    removeBubble();
    bubbleFor = [...taken];
    const message = combine(taken);
    optimisticUserMessageId = generateEntityId('messages');
    chat.internal_createClientMessage(
      optimisticUserMessageId,
      {
        agentId: context.agentId,
        content: message.content,
        editorData: message.editorData,
        files: message.files,
        groupId: context.groupId,
        metadata: { ...message.metadata, scope: LOCAL_MESSAGE_SCOPE, steer: true },
        role: 'user',
        threadId: context.threadId,
        topicId: context.topicId,
        ...getOptimisticMessageMedia(toUploadFiles(message)),
      },
      messageContext,
    );
  };

  try {
    const heldByRun = await takeBack(msgs);
    if (taken.length === 0 && heldByRun.length === 0) return 'delivered';
    showPendingBubble();

    // Cancel every blocker, including overlapping operations from a regenerate.
    const cancellationConfirmed = await Promise.all(
      runningOpIds.map((id) => chat.cancelOperation(id, SEND_NOW_CANCEL_REASON)),
    );
    if (cancellationConfirmed.some((confirmed) => !confirmed))
      throw new Error('Running agent cancellation was not confirmed');

    // The stop handed them back unless the run wrote them first.
    await takeBack(heldByRun);
    if (takeArrivals) {
      const arrivals = queueOf().filter(
        (queued) => !indexes.has(queued.id) && isWaitingQueuedMessage(queued),
      );
      await takeBack(arrivals);
    }
    if (taken.length === 0) return 'delivered';
    showPendingBubble();

    taken.sort((a, b) => a.createdAt - b.createdAt);
    const message = combine(taken);
    await chat.sendMessage({
      context,
      editorData: message.editorData,
      files: toUploadFiles(message),
      ...(message.forceRuntime ? { forceRuntime: message.forceRuntime } : {}),
      message: message.content,
      metadata: { ...message.metadata, steer: true },
      onMessageAccepted: () => {
        accepted = true;
      },
      onMessagePersisted: () => {
        persisted = true;
      },
      optimisticUserMessageId,
      preserveComposer: true,
    });
    if (!accepted) throw new Error('The queued message was not accepted');
    return 'sent';
  } finally {
    if (!accepted) {
      // Back at their own places, in order, so the queue reads as before.
      const restore = taken
        .map((msg) => ({ index: indexes.get(msg.id) ?? -1, msg }))
        .map(({ index, msg }) => ({ index: index < 0 ? Number.MAX_SAFE_INTEGER : index, msg }))
        .sort((a, b) => a.index - b.index);
      for (const { index, msg } of restore)
        chat.restoreQueuedMessage(
          contextKey,
          {
            ...msg,
            serverDelivering: undefined,
            serverDelivery: undefined,
            serverUnconfirmed: undefined,
          },
          index,
        );
    }
    // The gateway may acknowledge persistence before its transcript catches up.
    // Keep that bubble until the same ID arrives with the persisted row.
    if (!persisted) removeBubble();
  }
};

/** "Send now" for one queued message; the rest of the queue stays in place. */
export const sendQueuedMessageNow = ({
  msg,
  ...params
}: Omit<SendQueuedMessagesNowParams, 'msgs' | 'takeArrivals'> & { msg: QueuedMessage }) =>
  sendQueuedMessagesNow({ ...params, msgs: [msg] });
