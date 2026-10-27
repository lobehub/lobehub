import type { ConversationContext, OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

import type { PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';
import type { SendButtonProps } from '@/features/ChatInput/store/initialState';
import { chatHelpers } from '@/store/chat/helpers';
import { operationSelectors } from '@/store/chat/selectors';
import {
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
  SEND_NOW_CANCEL_REASON,
} from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
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
  waitsForRunEnd,
}: {
  count: number;
  waitsForRunEnd: boolean;
}) => {
  const merged = count > 1;

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

export const getContextWindowMessages = (
  messages: UIChatMessage[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
  },
) => toChatInputMessages(chatHelpers.getSlicedMessages(messages, options));

export const getConversationSendButtonProps = (
  defaults: SendButtonProps,
  overrides: Partial<SendButtonProps> | undefined,
  isUploadingFiles: boolean,
): SendButtonProps => ({
  ...defaults,
  ...overrides,
  // Uploads are a hard gate even when a host explicitly enables sending.
  disabled: isUploadingFiles || (overrides?.disabled ?? defaults.disabled),
});

export interface ConversationChatInputUiState {
  placeholderVariant: PlaceholderVariant;
  showSendMenu: boolean;
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
    showSendMenu: !isInputLoading,
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
 * Withdrawn first: interrupting a run that already took it from the server
 * would leave that copy unanswered. `withdraw` resolving `false` means it is
 * already on its way, so nothing is stopped or sent. Should the interrupt
 * fail, it goes back to the tray, held by this client only.
 */
export const sendQueuedMessageNow = async ({
  chat,
  context,
  contextKey,
  msg,
  withdraw,
}: {
  chat: ChatStore;
  context: ConversationContext;
  contextKey: string;
  msg: QueuedMessage;
  withdraw: (msg: QueuedMessage) => Promise<boolean>;
}): Promise<void> => {
  const index = chat.queuedMessages[contextKey]?.findIndex((queued) => queued.id === msg.id) ?? -1;
  if (!(await withdraw(msg))) return;
  // Back where it was, so the order the user queued in holds.
  const putBack = () =>
    chat.restoreQueuedMessage(
      contextKey,
      { ...msg, serverDelivery: undefined, serverUnconfirmed: undefined },
      index < 0 ? Number.MAX_SAFE_INTEGER : index,
    );

  // Cancel EVERY running blocker the item could be queued behind, not just the
  // first: matching one op would miss an interim blocker or the second of the
  // two concurrent `regenerate` ops a delAndRegenerate/delAndResendThread retry
  // runs (outer wrapper + inner regenerateUserMessage). Leaving any blocker
  // running would make the sendMessage below re-enqueue the item, so "Send now"
  // becomes a no-op. The selector shares the queue-blocking predicate with the
  // enqueue check.
  const runningOpIds = operationSelectors.getRunningQueueBlockingOperationIds(context)(chat);
  const cancellationConfirmed = await Promise.all(
    runningOpIds.map((id) => chat.cancelOperation(id, SEND_NOW_CANCEL_REASON)),
  ).catch((error: unknown) => {
    putBack();
    throw error;
  });
  if (cancellationConfirmed.some((confirmed) => !confirmed)) {
    putBack();
    throw new Error('Running agent cancellation was not confirmed');
  }

  // Reconstruct UploadFileItem-shaped objects so the optimistic temp message
  // can rebuild imageList/videoList from the snapshotted preview metadata.
  const files = msg.filesPreview?.length
    ? reconstructUploadFilesFromQueue(msg.filesPreview)
    : msg.files?.length
      ? (msg.files.map((id) => ({ id })) as any)
      : undefined;
  await chat.sendMessage({
    context,
    editorData: msg.editorData,
    files,
    message: msg.content,
    metadata: { ...msg.metadata, steer: true },
  });
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
