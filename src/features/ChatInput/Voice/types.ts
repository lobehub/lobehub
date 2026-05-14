import type { ChatMessageError } from '@lobechat/types';

export type VoiceCallStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'active'
  | 'error';

export interface VoiceConversationRuntime {
  getLatestAssistantText?: () => string | undefined;
  isBusy?: () => boolean;
  sendTurn: (text: string) => Promise<void>;
  stop?: () => void;
}

export interface VoiceRecorderActionProps {
  desc: string;
  disabled?: boolean;
  error?: ChatMessageError;
  formattedTime: string;
  handleCloseError: () => void;
  handleRetry: () => void;
  handleTriggerStartStop: () => void;
  isLoading: boolean;
  isRecording: boolean;
  time: number;
}
