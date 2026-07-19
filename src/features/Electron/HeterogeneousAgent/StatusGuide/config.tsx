import {
  AMP_CLI_INSTALL_COMMANDS,
  AMP_CLI_INSTALL_DOCS_URL,
  CLAUDE_CODE_CLI_INSTALL_COMMANDS,
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_COMMANDS,
  CODEX_CLI_INSTALL_DOCS_URL,
} from '@lobechat/electron-client-ipc';
import { Amp, ClaudeCode, Codex } from '@lobehub/icons';

import {
  type HeterogeneousAgentGuideConfig,
  SUPPORTED_HETEROGENEOUS_AGENT_TYPES,
  type SupportedHeterogeneousAgentType,
} from './types';

export const HETEROGENEOUS_AGENT_GUIDE_CONFIG = {
  'amp': {
    docsUrl: AMP_CLI_INSTALL_DOCS_URL,
    icon: Amp,
    installCommands: AMP_CLI_INSTALL_COMMANDS,
    signInCommand: 'amp login',
    title: 'Amp',
    translationPrefix: 'ampInstallGuide',
  },
  'claude-code': {
    docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
    icon: ClaudeCode,
    installCommands: CLAUDE_CODE_CLI_INSTALL_COMMANDS,
    signInCommand: 'claude',
    title: 'Claude Code',
    translationPrefix: 'claudeCodeInstallGuide',
  },
  'codex': {
    docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
    icon: Codex,
    installCommands: CODEX_CLI_INSTALL_COMMANDS,
    signInCommand: 'codex',
    title: 'Codex',
    translationPrefix: 'codexInstallGuide',
  },
} as const satisfies Record<SupportedHeterogeneousAgentType, HeterogeneousAgentGuideConfig>;

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
