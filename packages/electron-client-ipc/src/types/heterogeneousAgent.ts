export const CODEX_CLI_INSTALL_DOCS_URL =
  'https://github.com/openai/codex#installing-and-running-codex-cli';

export const CODEX_CLI_INSTALL_COMMANDS = [
  'npm install -g @openai/codex',
  'brew install --cask codex',
] as const;

export const HeterogeneousAgentSessionErrorCode = {
  CliNotFound: 'cli_not_found',
} as const;

export type HeterogeneousAgentSessionErrorCode =
  (typeof HeterogeneousAgentSessionErrorCode)[keyof typeof HeterogeneousAgentSessionErrorCode];

export interface HeterogeneousAgentSessionError {
  agentType?: string;
  code?: HeterogeneousAgentSessionErrorCode | string;
  command?: string;
  docsUrl?: string;
  installCommands?: readonly string[];
  message: string;
}
