import { getSlicedMessages } from '@lobechat/context-engine';
import type {
  ConversationContext,
  FollowUpMode,
  OpenAIChatMessage,
  UIChatMessage,
} from '@lobechat/types';
import { generateEntityId } from '@lobechat/utils';

import type { PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';
import type { ContextWindow, SendButtonProps } from '@/features/ChatInput/store/initialState';
import { operationSelectors } from '@/store/chat/selectors';
import { getOptimisticMessageMedia } from '@/store/chat/slices/agentRun/actions/entries/conversationLifecycle/optimisticMessageMedia';
import {
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
  SEND_NOW_CANCEL_REASON,
} from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { isLocalOnlyMessage, LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';
import type { UploadFileItem } from '@/types/files/upload';
import { isMachineErrorMessage } from '@/utils/machineErrorMessage';

type SupportedChatInputRole = Extract<OpenAIChatMessage['role'], 'assistant' | 'tool' | 'user'>;

interface ChatInputMessage {
  content: string;
  role: SupportedChatInputRole;
}

/** Coordinates mutually exclusive “Send now” attempts within one conversation tray. */
export interface QueueSendNowGate {
  /**
   * Runs one send-now task when the gate is idle.
   *
   * @returns `true` when the task ran, or `false` when another task already owns the gate.
   */
  run: (task: () => Promise<void>) => Promise<boolean>;
}

/**
 * Creates a conversation-scoped gate for queued “Send now” actions.
 *
 * Use when:
 * - Multiple queued rows can request replacement of the same running agent turn.
 * - A second click must remain queued while the first cancellation is settling.
 *
 * Expects:
 * - The caller keeps one gate instance for the lifetime of a conversation tray.
 * - Each task owns cancellation and dispatch from start through completion.
 *
 * Returns:
 * - A gate that executes at most one task at a time and rejects overlapping attempts.
 */
export const createQueueSendNowGate = (): QueueSendNowGate => {
  let active = false;

  return {
    run: async (task) => {
      if (active) return false;
      active = true;

      try {
        await task();
        return true;
      } finally {
        active = false;
      }
    },
  };
};

/**
 * Resolves the locale key that tells a queued follow-up when it will be sent.
 *
 * Use when:
 * - Captioning a QueueTray row with the queue's send timing.
 *
 * Expects:
 * - `count` is the number of queued items; more than one is merged into a single send.
 * - `waitsForRunEnd` is true when the queue waits behind a heterogeneous CLI run (Claude Code,
 *   Codex, …; see `operationSelectors.isQueueDrainedAtRunEnd`). That run cannot hand the turn
 *   back at a step boundary, so the queue only drains once the whole run ends, whereas the
 *   built-in runtime hands the turn back after the current tool step.
 *
 * Returns:
 * - A `chat` namespace key under `inputQueue`.
 */
export const getQueuedHintKey = ({
  count,
  mode = 'legacy',
  waitsForRunEnd,
}: {
  count: number;
  /** The Follow-up behavior in effect (`legacy` while its lab is off). */
  mode?: FollowUpMode;
  waitsForRunEnd: boolean;
}) => {
  const merged = count > 1;

  // Queue: every follow-up waits for the run end, then goes one per turn.
  if (mode === 'queue')
    return merged ? 'inputQueue.queuedOneByOneHint' : 'inputQueue.queuedRunEndHint';
  // Steer: joins the running turn, unless this run cannot take one mid-run.
  if (mode === 'steer') {
    if (waitsForRunEnd)
      return merged ? 'inputQueue.steerUnsupportedMergeHint' : 'inputQueue.steerUnsupportedHint';
    return merged ? 'inputQueue.steerMergeHint' : 'inputQueue.steerHint';
  }

  if (waitsForRunEnd)
    return merged ? 'inputQueue.queuedRunEndMergeHint' : 'inputQueue.queuedRunEndHint';

  return merged ? 'inputQueue.queuedMergeHint' : 'inputQueue.queuedHint';
};

const isSupportedChatInputMessage = (
  message: UIChatMessage,
): message is UIChatMessage & { role: SupportedChatInputRole } =>
  message.role === 'user' || message.role === 'assistant' || message.role === 'tool';

export const toChatInputMessages = (messages: UIChatMessage[]): ChatInputMessage[] =>
  messages.filter(isSupportedChatInputMessage).map((m) => ({
    content: typeof m.content === 'string' ? m.content : '',
    role: m.role,
  }));

const getRecordedInputTokens = (message: UIChatMessage) =>
  message.usage?.totalInputTokens ??
  message.metadata?.usage?.totalInputTokens ??
  message.metadata?.totalInputTokens;

/**
 * Resolves what the conversation's next request carries before the composer draft.
 *
 * Use when:
 * - Feeding the composer's context breakdown.
 *
 * Expects:
 * - `messages` are the conversation's flat DB messages in send order.
 *
 * Returns:
 * - `history`: the window the next request includes, sliced with the context
 *   engine's own group-aware history truncation.
 * - `request`, when the latest assistant message carries
 *   `metadata.contextAccounting`: that request's accounting and model. Without
 *   a history count it also carries the messages sent since — the reply
 *   itself, its tool results and later turns — which the next request appends
 *   to the recorded one. With a history count every request re-truncates, so
 *   those older messages may drop out and only `history` is reliable.
 */
export const getContextWindow = (
  messages: UIChatMessage[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
  },
): ContextWindow => {
  const history = getSlicedMessages(messages, options) as UIChatMessage[];
  const historyTruncated = !!options.enableHistoryCount && options.historyCount !== undefined;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const accounting = message.role === 'assistant' && message.metadata?.contextAccounting;
    if (!accounting) continue;

    const inputTokens = getRecordedInputTokens(message);
    return {
      history,
      request: {
        accounting,
        ...(inputTokens ? { inputTokens } : {}),
        ...(historyTruncated ? {} : { messages: messages.slice(index) }),
        model: message.model ?? undefined,
        provider: message.provider ?? undefined,
      },
    };
  }

  return { history };
};

export const getConversationSendButtonProps = (
  defaults: SendButtonProps,
  overrides: Partial<SendButtonProps> | undefined,
): SendButtonProps => ({
  ...defaults,
  ...overrides,
  disabled: overrides?.disabled ?? defaults.disabled,
});

/**
 * Split a composer's uploads into those the message can carry and those it cannot.
 *
 * Use when:
 * - Sending from the composer: a failed or cancelled upload has no stored file, so
 *   it is left out of the message instead of being sent as a dangling id.
 *
 * Returns:
 * - `sendable` in composer order, which is the order image numbers
 *   (`[Image #N]`) are counted in, and `failed`, which stays in the composer.
 */
export const partitionSendableUploads = <T extends Pick<UploadFileItem, 'status'>>(
  files: T[],
): { failed: T[]; sendable: T[] } => {
  const failed: T[] = [];
  const sendable: T[] = [];
  for (const file of files) {
    if (file.status === 'error' || file.status === 'cancelled') failed.push(file);
    else sendable.push(file);
  }
  return { failed, sendable };
};

export interface ConversationChatInputUiState {
  placeholderVariant: PlaceholderVariant;
  /** Show Send beside Stop so a typed follow-up can be queued by click. */
  showSendWhileGenerating: boolean;
  showStopButton: boolean;
}

export interface GetConversationChatInputUiStateParams {
  /**
   * When true, the placeholder never flips to the followUp variant — used by
   * surfaces (e.g. onboarding) that have no follow-up / pending-message design.
   */
  disableFollowUpVariant?: boolean;
  /** Sending is blocked while loading, so no Send button appears beside Stop. */
  disableQueue?: boolean;
  isInputEmpty: boolean;
  isInputLoading: boolean;
}

export const getConversationChatInputUiState = ({
  disableFollowUpVariant,
  disableQueue,
  isInputEmpty,
  isInputLoading,
}: GetConversationChatInputUiStateParams): ConversationChatInputUiState => {
  // Keep the Stop button up for the entire loading window — including when the
  // user starts typing a follow-up. Replacing Stop with Send read as "agent
  // finished" and made queued sends look like fresh sends. Once the composer
  // has content, Send appears beside Stop instead; Enter and Send both enqueue.
  const followUp = !disableFollowUpVariant && isInputLoading && isInputEmpty;
  return {
    placeholderVariant: followUp ? 'followUp' : 'default',
    showSendWhileGenerating: isInputLoading && !isInputEmpty && !disableQueue,
    showStopButton: isInputLoading,
  };
};

/**
 * Resolve the text the send-failure notice should show for a raw error message.
 *
 * Use when:
 * - Rendering `inputSendErrorMsg`, which is the failed call's message verbatim.
 *   On any surface that does not go through the server's `databaseError`
 *   middleware it can still be Drizzle's `Failed query: <sql>` / `params:
 *   <values>` dump — the whole statement plus every bound parameter, including
 *   the user's own message body.
 *
 * Returns:
 * - The message to display, or `undefined` when the caller must substitute its
 *   own localized copy — i.e. the raw message was machine output, not a
 *   sentence written for the person.
 */
export const toDisplayableSendErrorMessage = (message?: string): string | undefined => {
  const trimmed = message?.trim();
  if (!trimmed) return undefined;
  if (isMachineErrorMessage(trimmed)) return undefined;

  return trimmed;
};

/**
 * "Send now" for one queued message: take it out of the queue, stop every run
 * it waits behind, then send it as a steered turn.
 *
 * Withdrawn first: interrupting a run that already wrote it into the
 * conversation would leave that copy unanswered. One the run took but has not
 * written yet (a CLI agent only reads it between its own turns) still
 * interrupts: the stop returns it to this tab, and it is withdrawn again and
 * sent. Should the interrupt fail, a withdrawn item goes back to the tray,
 * held by this client only.
 *
 * @returns `'delivered'` when the run already has it, so nothing was sent
 */
export const sendQueuedMessageNow = async ({
  context,
  contextKey,
  getChat,
  msg,
  withdraw,
}: {
  context: ConversationContext;
  contextKey: string;
  getChat: () => ChatStore;
  msg: QueuedMessage;
  /** Throws when the server cannot be asked; `false` means the run has it. */
  withdraw: (msg: QueuedMessage) => Promise<boolean>;
}): Promise<'delivered' | 'sent'> => {
  const chat = getChat();
  const messageContext = { conversationContext: context };
  const index = chat.queuedMessages[contextKey]?.findIndex((queued) => queued.id === msg.id) ?? -1;
  const runningOpIds = operationSelectors.getRunningQueueBlockingOperationIds(context)(chat);
  const files = msg.filesPreview?.length
    ? reconstructUploadFilesFromQueue(msg.filesPreview)
    : msg.files?.length
      ? (msg.files.map((id) => ({ id })) as UploadFileItem[])
      : undefined;
  const metadata = { ...msg.metadata, steer: true };
  let optimisticUserMessageId: string | undefined;
  let accepted = false;
  let persisted = false;
  let withdrawn = await withdraw(msg);
  // A `false` that leaves it in the tray means "taken, not yet written".
  if (!withdrawn && !getChat().queuedMessages[contextKey]?.some((queued) => queued.id === msg.id))
    return 'delivered';

  const showPendingBubble = () => {
    if (!context.topicId || context.isNew) return;
    optimisticUserMessageId = generateEntityId('messages');
    chat.internal_createClientMessage(
      optimisticUserMessageId,
      {
        agentId: context.agentId,
        content: msg.content,
        editorData: msg.editorData,
        files: msg.files,
        groupId: context.groupId,
        metadata: { ...metadata, scope: LOCAL_MESSAGE_SCOPE },
        role: 'user',
        threadId: context.threadId,
        topicId: context.topicId,
        ...getOptimisticMessageMedia(files),
      },
      messageContext,
    );
  };

  try {
    if (withdrawn) showPendingBubble();

    // Cancel every blocker, including overlapping operations from a regenerate.
    const cancellationConfirmed = await Promise.all(
      runningOpIds.map((id) => chat.cancelOperation(id, SEND_NOW_CANCEL_REASON)),
    );
    if (cancellationConfirmed.some((confirmed) => !confirmed))
      throw new Error('Running agent cancellation was not confirmed');

    // The stop handed it back unless the run wrote it first.
    if (!withdrawn) {
      withdrawn = await withdraw(msg);
      if (!withdrawn) return 'delivered';
      showPendingBubble();
    }

    await chat.sendMessage({
      context,
      editorData: msg.editorData,
      files,
      ...(msg.forceRuntime ? { forceRuntime: msg.forceRuntime } : {}),
      message: msg.content,
      metadata,
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
    if (withdrawn && !accepted) {
      chat.restoreQueuedMessage(
        contextKey,
        {
          ...msg,
          serverDelivering: undefined,
          serverDelivery: undefined,
          serverUnconfirmed: undefined,
        },
        index < 0 ? Number.MAX_SAFE_INTEGER : index,
      );
    }
    // The gateway may acknowledge persistence before its transcript catches up.
    // Keep that bubble until the same ID arrives with the persisted row.
    if (optimisticUserMessageId && !persisted) {
      const preview = getChat().dbMessagesMap[contextKey]?.find(
        (message) => message.id === optimisticUserMessageId,
      );
      if (isLocalOnlyMessage(preview))
        chat.internal_dispatchMessage(
          { id: optimisticUserMessageId, type: 'deleteMessage' },
          messageContext,
        );
    }
  }
};

/**
 * Put a queued message back into the composer for editing. The structured
 * document keeps its selected skills, tools and @-mentions, which the send
 * reads back from it; markdown only when there is none.
 */
export const putQueuedMessageInEditor = (
  editor: { setDocument: (type: string, content: any) => void },
  msg: Pick<QueuedMessage, 'content' | 'editorData'>,
) => {
  if (msg.editorData) editor.setDocument('json', msg.editorData);
  else editor.setDocument('markdown', msg.content);
};
