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

export interface HeterogeneousAgentStatusGuideProps {
  agentType?: string;
  autoRetry?: HeterogeneousAgentAutoRetryState;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  onRetry?: () => void;
  variant?: HeterogeneousAgentStatusGuideVariant;
}

export const SUPPORTED_HETEROGENEOUS_AGENT_TYPES = ['claude-code', 'codex'] as const;

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
  variant: HeterogeneousAgentStatusGuideVariant;
}
