import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import type { ComponentType } from 'react';

export type HeterogeneousAgentStatusGuideVariant = 'compact' | 'embedded' | 'inline';

export interface HeterogeneousAgentStatusGuideProps {
  agentType?: string;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
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
  config: HeterogeneousAgentGuideConfig;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  variant: HeterogeneousAgentStatusGuideVariant;
}
