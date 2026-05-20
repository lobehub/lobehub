export const CLAUDE_CODE_CLI_INSTALL_DOCS_URL =
  'https://docs.anthropic.com/en/docs/claude-code/setup';

export const CLAUDE_CODE_CLI_INSTALL_COMMANDS = [
  'curl -fsSL https://claude.ai/install.sh | bash',
  'brew install --cask claude-code',
] as const;

export const CODEX_CLI_INSTALL_DOCS_URL =
  'https://github.com/openai/codex#installing-and-running-codex-cli';

export const CODEX_CLI_INSTALL_COMMANDS = [
  'npm install -g @openai/codex',
  'brew install --cask codex',
] as const;

export const HeterogeneousAgentSessionErrorCode = {
  AuthRequired: 'auth_required',
  CliNotFound: 'cli_not_found',
  RateLimit: 'rate_limit',
  ResumeCwdMismatch: 'resume_cwd_mismatch',
  ResumeThreadNotFound: 'resume_thread_not_found',
} as const;

export type HeterogeneousAgentSessionErrorCode =
  (typeof HeterogeneousAgentSessionErrorCode)[keyof typeof HeterogeneousAgentSessionErrorCode];

export interface HeterogeneousAgentRateLimitInfo {
  isUsingOverage?: boolean;
  overageDisabledReason?: string;
  overageStatus?: string;
  rateLimitType?: string;
  resetsAt?: number;
  status?: string;
}

export interface HeterogeneousAgentSessionError {
  agentType?: string;
  code?: HeterogeneousAgentSessionErrorCode | string;
  command?: string;
  docsUrl?: string;
  installCommands?: readonly string[];
  message: string;
  rateLimitInfo?: HeterogeneousAgentRateLimitInfo;
  resumeSessionId?: string;
  stderr?: string;
  workingDirectory?: string;
}
