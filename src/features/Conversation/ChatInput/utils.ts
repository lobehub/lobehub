import type { InputTokenRatioAnchor } from '@lobechat/context-engine';
import { getSlicedMessages } from '@lobechat/context-engine';
import type { FollowUpBehavior, OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

import type { PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';
import type { ContextWindow, SendButtonProps } from '@/features/ChatInput/store/initialState';
import { type QueuedMessage } from '@/store/chat/slices/operation/types';
import type { FileStore } from '@/store/file/store';
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
  mode,
  restartsRun,
  waitsForRunEnd,
}: {
  count: number;
  /** The user's Follow-up behavior. */
  mode: FollowUpBehavior;
  /**
   * The run can't take a steer and "restart agents that can't steer" is on, so
   * the queue stops it and starts the next turn instead of waiting.
   */
  restartsRun?: boolean;
  waitsForRunEnd: boolean;
}) => {
  const merged = count > 1;

  // Queue: every follow-up waits for the run end, then goes one per turn.
  if (mode === 'queue')
    return merged ? 'inputQueue.queuedOneByOneHint' : 'inputQueue.queuedRunEndHint';
  // Steer: joins the running turn, unless this run cannot take one mid-run.
  if (restartsRun)
    return merged ? 'inputQueue.steerRestartMergeHint' : 'inputQueue.steerRestartHint';
  if (waitsForRunEnd)
    return merged ? 'inputQueue.steerUnsupportedMergeHint' : 'inputQueue.steerUnsupportedHint';
  return merged ? 'inputQueue.steerMergeHint' : 'inputQueue.steerHint';
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
        ...(message.metadata?.usageEstimated ? { inputTokensEstimated: true } : {}),
        ...(historyTruncated ? {} : { messages: messages.slice(index) }),
        model: message.model ?? undefined,
        provider: message.provider ?? undefined,
      },
    };
  }

  return { history };
};

/**
 * Picks the recorded request that calibrates estimates for the selected model.
 *
 * Use when:
 * - Building the `anchor` for `resolveInputTokenRatio`.
 *
 * Returns:
 * - The request's provider-reported input against its estimate, only when it went to exactly
 *   this model and provider (another one measured another tokenizer or relay prompt) and its
 *   input tokens are not the runtime's own estimate. Otherwise `undefined`.
 */
export const getInputTokenRatioAnchor = (
  request: ContextWindow['request'],
  selection: { model?: string; provider?: string },
): InputTokenRatioAnchor | undefined => {
  if (!request || request.inputTokensEstimated) return;
  if (request.model !== selection.model || request.provider !== selection.provider) return;

  return {
    actualTokens: request.inputTokens,
    estimatedTokens: request.accounting.total,
    media: request.accounting.media,
  };
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

/**
 * Empty the composer of what a send took: the sent attachments and the context
 * selections. A failed or cancelled upload was not sent, so it stays to retry or remove.
 */
export const clearSentAttachments = (
  fileStore: Pick<FileStore, 'clearChatContextSelections' | 'clearChatUploadFileList'>,
  contextKey: string,
  sentFiles: Pick<UploadFileItem, 'id'>[],
) => {
  fileStore.clearChatUploadFileList(
    contextKey,
    sentFiles.map((file) => file.id),
  );
  fileStore.clearChatContextSelections(contextKey);
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
