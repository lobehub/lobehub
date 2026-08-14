import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import {
  Amp,
  ClaudeCode,
  CodeBuddy,
  Codex,
  Cursor,
  Grok,
  Kimi,
  OpenCode,
  Pi,
  Qoder,
} from '@lobehub/icons';

import {
  type HeterogeneousAgentGuideConfig,
  SUPPORTED_HETEROGENEOUS_AGENT_TYPES,
  type SupportedHeterogeneousAgentType,
} from './types';

const GUIDE_PRESENTATION_CONFIG = {
  'amp': {
    icon: Amp,
    translationPrefix: 'ampInstallGuide',
  },
  'claude-code': {
    icon: ClaudeCode,
    translationPrefix: 'claudeCodeInstallGuide',
  },
  'codebuddy': {
    icon: CodeBuddy,
    translationPrefix: 'codeBuddyInstallGuide',
  },
  'codex': {
    icon: Codex,
    translationPrefix: 'codexInstallGuide',
  },
  'cursor': {
    icon: Cursor,
    translationPrefix: 'cursorInstallGuide',
  },
  'grok-build': {
    icon: Grok,
    translationPrefix: 'grokBuildInstallGuide',
  },
  'kimi-code': {
    icon: Kimi,
    translationPrefix: 'kimiCodeInstallGuide',
  },
  'opencode': {
    icon: OpenCode,
    translationPrefix: 'opencodeInstallGuide',
  },
  'pi': {
    icon: Pi,
    translationPrefix: 'piInstallGuide',
  },
  'qoder': {
    icon: Qoder,
    translationPrefix: 'qoderInstallGuide',
  },
} as const satisfies Record<
  LocalHeterogeneousAgentType,
  Pick<HeterogeneousAgentGuideConfig, 'icon' | 'translationPrefix'>
>;

const createGuideConfig = () => {
  const configs = {} as Record<SupportedHeterogeneousAgentType, HeterogeneousAgentGuideConfig>;

  for (const descriptor of HETEROGENEOUS_AGENT_CONFIGS) {
    configs[descriptor.type] = {
      docsUrl: descriptor.install.docsUrl,
      installCommands: descriptor.install.commands,
      signInCommand: descriptor.auth.signInCommand,
      title: descriptor.title,
      ...GUIDE_PRESENTATION_CONFIG[descriptor.type],
    };
  }

  return configs;
};

export const HETEROGENEOUS_AGENT_GUIDE_CONFIG = createGuideConfig();

export const isSupportedHeterogeneousAgentType = (
  value?: string,
): value is SupportedHeterogeneousAgentType =>
  !!value && SUPPORTED_HETEROGENEOUS_AGENT_TYPES.includes(value as SupportedHeterogeneousAgentType);

export const resolveHeterogeneousAgentGuideConfig = (options: {
  agentType?: string;
  errorAgentType?: string;
}) => {
  const resolvedAgentType = isSupportedHeterogeneousAgentType(options.errorAgentType)
    ? options.errorAgentType
    : isSupportedHeterogeneousAgentType(options.agentType)
      ? options.agentType
      : 'codex';

  return HETEROGENEOUS_AGENT_GUIDE_CONFIG[resolvedAgentType];
};
