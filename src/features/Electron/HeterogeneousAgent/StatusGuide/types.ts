import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import type { ComponentType } from 'react';

export type HeterogeneousAgentStatusGuideVariant = 'compact' | 'embedded' | 'inline';

/**
 * Present while an `overloaded` error is auto-retrying. When absent, the
 * overloaded guide renders its static manual-retry card.
 */
export interface HeterogeneousAgentAutoRetryState {
  attempt: number;
  maxAttempts: number;
  onCancel: () => void;
  onRetryNow: () => void;
  secondsLeft: number;
}

/**
 * View-model for the rate-limit guide's "continue after reset" scheduling. When
 * present, the card can hand the continuation off to the backend instead of
 * requiring a manual retry. `isScheduled` toggles between the unscheduled entry
 * (schedule / retry-now) and the scheduled state (run-now / cancel).
 */
export interface HeterogeneousAgentScheduleState {
  isScheduled: boolean;
  onCancel: () => void;
  onRunNow: () => void;
  onSchedule: () => void;
  /** Epoch seconds when the rate-limit window resets (for the "~X h" copy). */
  resetsAt?: number;
}

export interface HeterogeneousAgentStatusGuideProps {
  agentType?: string;
  autoRetry?: HeterogeneousAgentAutoRetryState;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  onRetry?: () => void;
  schedule?: HeterogeneousAgentScheduleState;
  variant?: HeterogeneousAgentStatusGuideVariant;
}

export const SUPPORTED_HETEROGENEOUS_AGENT_TYPES = ['amp', 'claude-code', 'codex'] as const;

export type SupportedHeterogeneousAgentType = (typeof SUPPORTED_HETEROGENEOUS_AGENT_TYPES)[number];

export interface HeterogeneousAgentGuideConfig {
  docsUrl: string;
  icon: ComponentType<{ size?: number }>;
  installCommands: readonly string[];
  signInCommand: string;
  title: string;
  translationPrefix: string;
}

export interface HeterogeneousAgentGuideStateProps {
  autoRetry?: HeterogeneousAgentAutoRetryState;
  config: HeterogeneousAgentGuideConfig;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  onRetry?: () => void;
  schedule?: HeterogeneousAgentScheduleState;
  variant: HeterogeneousAgentStatusGuideVariant;
}
