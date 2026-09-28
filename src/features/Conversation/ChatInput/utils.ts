import type { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

import type { PlaceholderVariant } from '@/features/ChatInput/InputEditor/Placeholder';
import type { SendButtonProps } from '@/features/ChatInput/store/initialState';
import { chatHelpers } from '@/store/chat/helpers';

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
