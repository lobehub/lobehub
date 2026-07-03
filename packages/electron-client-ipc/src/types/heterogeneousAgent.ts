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
  Overloaded: 'overloaded',
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

export interface HeteroQuotaWindow {
  resetsAt: number | null;
  usedPercent: number;
  windowMinutes: number;
}

export type CodexQuotaWindow = HeteroQuotaWindow;

export interface CodexRateLimitResetCredits {
  availableCount: number;
  credits?: {
    expiresAt: number | null;
    grantedAt: number | null;
    status: string;
  }[];
  nextExpiresAt?: number | null;
  totalEarnedCount?: number;
}

export interface CodexQuotaSnapshot {
  error: string | null;
  provider: 'codex';
  rateLimitResetCredits?: CodexRateLimitResetCredits | null;
  session: CodexQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  weekly: CodexQuotaWindow | null;
}

/**
 * Why the quota can't be shown. `external-auth` means the agent is configured
 * with an API key / custom base url, so subscription quota does not apply;
 * the credential reasons mean no fresh OAuth login was found on this machine.
 */
export type ClaudeCodeQuotaUnavailableReason =
  'credentials-expired' | 'credentials-not-found' | 'external-auth';

export interface ClaudeCodeScopedWeekly {
  /** Display name of the model the window is scoped to, e.g. "Fable". */
  modelName: string;
  window: HeteroQuotaWindow;
}

export interface ClaudeCodeQuotaSnapshot {
  error: string | null;
  provider: 'claude-code';
  reason?: ClaudeCodeQuotaUnavailableReason;
  /** Model-scoped weekly window (e.g. Fable/Opus), when the plan reports one. */
  scopedWeekly: ClaudeCodeScopedWeekly | null;
  session: HeteroQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  weekly: HeteroQuotaWindow | null;
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
