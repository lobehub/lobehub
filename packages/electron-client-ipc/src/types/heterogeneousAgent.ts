import type { HeteroQuotaWindow } from '@lobechat/heterogeneous-agents/quota';

import type { HeterogeneousCliAgentType } from './binary';

export {
  AMP_CLI_INSTALL_COMMANDS,
  AMP_CLI_INSTALL_DOCS_URL,
  CLAUDE_CODE_CLI_INSTALL_COMMANDS,
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_COMMANDS,
  CODEX_CLI_INSTALL_DOCS_URL,
  OPENCODE_CLI_INSTALL_COMMANDS,
  OPENCODE_CLI_INSTALL_DOCS_URL,
  PI_CLI_INSTALL_COMMANDS,
  PI_CLI_INSTALL_DOCS_URL,
  QODER_CLI_AUTH_DOCS_URL,
  QODER_CLI_INSTALL_COMMANDS,
  QODER_CLI_INSTALL_DOCS_URL,
} from '@lobechat/heterogeneous-agents';

export const HeterogeneousAgentSessionErrorCode = {
  AuthRequired: 'auth_required',
  CliNotFound: 'cli_not_found',
  Overloaded: 'overloaded',
  RateLimit: 'rate_limit',
  ResumeCwdMismatch: 'resume_cwd_mismatch',
  ResumeThreadNotFound: 'resume_thread_not_found',
  WorkingDirectoryNotFound: 'working_directory_not_found',
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

// The Claude quota snapshot shapes are shared with the device RPC path
// (`lh connect` samples the same snapshot), so they live in the
// heterogeneous-agents quota entry; re-export them for existing IPC callers.
export type {
  ClaudeCodeAccountIdentity,
  ClaudeCodeQuotaReading,
  ClaudeCodeQuotaSnapshot,
  ClaudeCodeQuotaUnavailableReason,
  ClaudeCodeScopedWeekly,
  HeteroQuotaWindow,
} from '@lobechat/heterogeneous-agents/quota';

export type CodexQuotaWindow = HeteroQuotaWindow;

export interface CodexRateLimitSnapshot {
  /** Canonical metered limit identifier, for example `codex` or `codex_other`. */
  limitId: string;
  limitName: string | null;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
}

export interface CodexRateLimitResetCredit {
  expiresAt: number | null;
  grantedAt: number | null;
  /** Opaque backend identifier used only when redeeming this specific credit. */
  id: string | null;
  redeemedAt?: number | null;
  redeemStartedAt?: number | null;
  resetType: string | null;
  status: string;
  title: string | null;
}

export interface CodexRateLimitResetCredits {
  availableCount: number;
  /** Detailed rows when supported by the installed Codex CLI/backend. */
  credits?: CodexRateLimitResetCredit[];
  nextExpiresAt?: number | null;
  totalEarnedCount?: number;
}

export interface CodexQuotaSnapshot {
  error: string | null;
  provider: 'codex';
  rateLimitResetCredits?: CodexRateLimitResetCredits | null;
  /** Complete multi-bucket view when supported by the installed Codex app-server. */
  rateLimits?: CodexRateLimitSnapshot[];
  session: CodexQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  weekly: CodexQuotaWindow | null;
}

export type CodexRateLimitResetOutcome =
  'alreadyRedeemed' | 'noCredit' | 'nothingToReset' | 'reset';

export interface CodexRateLimitResetResult {
  outcome: CodexRateLimitResetOutcome;
  quota: CodexQuotaSnapshot;
}

export interface HeterogeneousAgentSessionError {
  agentType?: HeterogeneousCliAgentType;
  code?: HeterogeneousAgentSessionErrorCode | string;
  command?: string;
  /** Diagnostic context from the CLI's terminal event (subtype, HTTP status, turn count, …). */
  details?: Record<string, unknown>;
  docsUrl?: string;
  installCommands?: readonly string[];
  message: string;
  rateLimitInfo?: HeterogeneousAgentRateLimitInfo;
  resumeSessionId?: string;
  stderr?: string;
  workingDirectory?: string;
}

export type HeterogeneousAgentRuntimeState =
  'starting' | 'running' | 'monitoring' | 'idle' | 'stale' | 'closing' | 'closed' | 'error';

export interface HeterogeneousAgentRuntimeTask {
  description?: string;
  lastEventAt: number;
  startedAt: number;
  taskId: string;
  toolUseId?: string;
  type?: string;
}

export interface HeterogeneousAgentRuntimeStatus {
  activeTasks: HeterogeneousAgentRuntimeTask[];
  idleDeadlineAt?: number;
  lastEventAt: number;
  operationId?: string;
  sessionId: string;
  staleDeadlineAt?: number;
  state: HeterogeneousAgentRuntimeState;
  transport: 'claude-sdk' | 'cli-spawn' | 'codex-app-server';
}
