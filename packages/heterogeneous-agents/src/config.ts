import type {
  HeterogeneousAgentDescriptor,
  HeterogeneousAgentMenuLabelKey,
  HeterogeneousAgentType,
  LocalHeterogeneousAgentDescriptor,
  LocalHeterogeneousAgentType,
  RemoteHeterogeneousAgentDescriptor,
  RemoteHeterogeneousAgentType,
} from '@lobechat/types';
import { HETEROGENEOUS_AGENT_CONFIGS, REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/types';

export type {
  HeterogeneousAgentDescriptor,
  HeterogeneousAgentMenuLabelKey,
  HeterogeneousAgentType,
  LocalHeterogeneousAgentDescriptor,
  LocalHeterogeneousAgentType,
  RemoteHeterogeneousAgentDescriptor,
  RemoteHeterogeneousAgentType,
};
export { HETEROGENEOUS_AGENT_CONFIGS, REMOTE_HETEROGENEOUS_AGENT_CONFIGS };

/** @deprecated Use `LocalHeterogeneousAgentDescriptor`. */
export type HeterogeneousAgentConfig = LocalHeterogeneousAgentDescriptor;
/** @deprecated Use `RemoteHeterogeneousAgentDescriptor`. */
export type RemoteHeterogeneousAgentConfig = RemoteHeterogeneousAgentDescriptor;

export const LOCAL_HETEROGENEOUS_AGENT_TYPES = HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type);

const LOCAL_HETERO_TYPES = new Set<string>(LOCAL_HETEROGENEOUS_AGENT_TYPES);
const REMOTE_HETERO_TYPES = new Set<string>(
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type),
);

export const isLocalHeterogeneousType = (type: string): type is LocalHeterogeneousAgentType =>
  LOCAL_HETERO_TYPES.has(type);

export const isRemoteHeterogeneousType = (type: string): type is RemoteHeterogeneousAgentType =>
  REMOTE_HETERO_TYPES.has(type);

export const getHeterogeneousAgentConfig = (type: string) =>
  HETEROGENEOUS_AGENT_CONFIGS.find((config) => config.type === type);

export const getHeterogeneousAgentConfigOrThrow = (
  type: string,
): (typeof HETEROGENEOUS_AGENT_CONFIGS)[number] => {
  const config = getHeterogeneousAgentConfig(type);
  if (!config) throw new Error(`Unknown local heterogeneous agent type: "${type}"`);
  return config;
};

export const resolveHeterogeneousAgentCommand = (type: string, command?: string): string => {
  const configuredCommand = command?.trim();
  return configuredCommand || getHeterogeneousAgentConfigOrThrow(type).defaultCommand;
};

export interface HeterogeneousAgentCliError {
  agentType: LocalHeterogeneousAgentType;
  code: 'auth_required' | 'cli_not_found';
  command: string;
  docsUrl: string;
  installCommands?: readonly string[];
  message: string;
  stderr?: string;
}

interface BuildHeterogeneousAgentCliErrorOptions {
  agentType: string;
  command?: string;
  stderr?: string;
}

export const buildHeterogeneousAgentCliNotFoundError = ({
  agentType,
  command,
  stderr,
}: BuildHeterogeneousAgentCliErrorOptions): HeterogeneousAgentCliError => {
  const descriptor = getHeterogeneousAgentConfigOrThrow(agentType);
  const resolvedCommand = resolveHeterogeneousAgentCommand(agentType, command);

  return {
    agentType: descriptor.type,
    code: 'cli_not_found',
    command: resolvedCommand,
    docsUrl: descriptor.install.docsUrl,
    installCommands: descriptor.install.commands,
    message: `${descriptor.title} CLI was not found. Install it and make sure \`${resolvedCommand}\` can be executed.`,
    ...(stderr ? { stderr } : {}),
  };
};

export const buildHeterogeneousAgentAuthRequiredError = ({
  agentType,
  command,
  stderr,
}: BuildHeterogeneousAgentCliErrorOptions): HeterogeneousAgentCliError => {
  const descriptor = getHeterogeneousAgentConfigOrThrow(agentType);

  return {
    agentType: descriptor.type,
    code: 'auth_required',
    command: resolveHeterogeneousAgentCommand(agentType, command),
    docsUrl: descriptor.auth.docsUrl,
    message: descriptor.auth.errorMessage,
    ...(stderr ? { stderr } : {}),
  };
};

const AUTH_REQUIRED_PATTERNS = new Map<LocalHeterogeneousAgentType, readonly RegExp[]>();

export const isHeterogeneousAgentAuthRequired = (agentType: string, detail: string): boolean => {
  const descriptor = getHeterogeneousAgentConfig(agentType);
  if (!descriptor) return false;

  let patterns = AUTH_REQUIRED_PATTERNS.get(descriptor.type);
  if (!patterns) {
    patterns = descriptor.auth.patterns.map((source) => new RegExp(source, 'i'));
    AUTH_REQUIRED_PATTERNS.set(descriptor.type, patterns);
  }

  return patterns.some((pattern) => pattern.test(detail));
};

// Compatibility exports for existing IPC consumers. Values are derived from
// the descriptor catalog rather than maintained as a second metadata table.
const ampDescriptor = getHeterogeneousAgentConfigOrThrow('amp');
const claudeCodeDescriptor = getHeterogeneousAgentConfigOrThrow('claude-code');
const codeBuddyDescriptor = getHeterogeneousAgentConfigOrThrow('codebuddy');
const codexDescriptor = getHeterogeneousAgentConfigOrThrow('codex');
const cursorDescriptor = getHeterogeneousAgentConfigOrThrow('cursor');
const grokBuildDescriptor = getHeterogeneousAgentConfigOrThrow('grok-build');
const openCodeDescriptor = getHeterogeneousAgentConfigOrThrow('opencode');
const piDescriptor = getHeterogeneousAgentConfigOrThrow('pi');
const qoderDescriptor = getHeterogeneousAgentConfigOrThrow('qoder');

export const AMP_CLI_INSTALL_COMMANDS = ampDescriptor.install.commands;
export const AMP_CLI_INSTALL_DOCS_URL = ampDescriptor.install.docsUrl;
export const CLAUDE_CODE_CLI_INSTALL_COMMANDS = claudeCodeDescriptor.install.commands;
export const CLAUDE_CODE_CLI_INSTALL_DOCS_URL = claudeCodeDescriptor.install.docsUrl;
export const CODEBUDDY_CLI_INSTALL_COMMANDS = codeBuddyDescriptor.install.commands;
export const CODEBUDDY_CLI_INSTALL_DOCS_URL = codeBuddyDescriptor.install.docsUrl;
export const CODEX_CLI_INSTALL_COMMANDS = codexDescriptor.install.commands;
export const CODEX_CLI_INSTALL_DOCS_URL = codexDescriptor.install.docsUrl;
export const CURSOR_CLI_INSTALL_COMMANDS = cursorDescriptor.install.commands;
export const CURSOR_CLI_INSTALL_DOCS_URL = cursorDescriptor.install.docsUrl;
export const GROK_BUILD_CLI_INSTALL_COMMANDS = grokBuildDescriptor.install.commands;
export const GROK_BUILD_CLI_INSTALL_DOCS_URL = grokBuildDescriptor.install.docsUrl;
export const OPENCODE_CLI_INSTALL_COMMANDS = openCodeDescriptor.install.commands;
export const OPENCODE_CLI_INSTALL_DOCS_URL = openCodeDescriptor.install.docsUrl;
export const PI_CLI_INSTALL_COMMANDS = piDescriptor.install.commands;
export const PI_CLI_INSTALL_DOCS_URL = piDescriptor.install.docsUrl;
export const QODER_CLI_AUTH_DOCS_URL = qoderDescriptor.auth.docsUrl;
export const QODER_CLI_INSTALL_COMMANDS = qoderDescriptor.install.commands;
export const QODER_CLI_INSTALL_DOCS_URL = qoderDescriptor.install.docsUrl;
