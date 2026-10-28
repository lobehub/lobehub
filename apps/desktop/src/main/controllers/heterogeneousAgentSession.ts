import type { ChildProcess } from 'node:child_process';

import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type { PiRpcSession } from '@lobechat/heterogeneous-agents/rpc';
import type {
  ClaudeAgentSdkSession,
  CodexThreadSession,
  CursorAcpSession,
  DevinAcpSession,
  DroidAcpSession,
  DshAcpSessionHandle,
  GrokAcpSession,
  TraeAcpSession,
} from '@lobechat/heterogeneous-agents/spawn';
import type {
  HeterogeneousServerDefaultApiConfig,
  HeteroSessionImportMessage,
} from '@lobechat/types';

import type { HostedProviderBinding } from '@/modules/heterogeneousAgent/providerBindingHost';
import type { HeterogeneousAgentImageAttachment } from '@/modules/heterogeneousAgent/types';

/** Prompt and ownership context shared by desktop transports. */
export interface SendPromptParams {
  /**
   * Agent this run belongs to. Rides along to the renderer so it can tell
   * whether revealing the browser panel would yank the user's view to a run
   * they aren't watching.
   */
  agentId?: string;
  /** Assistant row this run streams into — recorded so recovery can scope to its branch. */
  assistantMessageId?: string;
  /** Image attachments to include in the prompt (downloaded from url, cached by id) */
  imageList?: HeterogeneousAgentImageAttachment[];
  /**
   * Renderer-side operation id stamped onto every emitted `AgentStreamEvent`.
   * Required: producer-side conversion is the V3 contract — by the time events
   * reach the renderer they must already carry the operation they belong to.
   */
  operationId: string;
  prompt: string;
  /**
   * Do not spawn the CLI. Instead, read the last turn of the session's on-disk
   * transcript (Claude Code only) and stream it through the same pipeline a
   * live process feeds, so a turn that finished or died while the app was
   * down lands in the topic exactly as it would have live. Resolves with the
   * replay outcome so the caller knows whether a `--resume` continuation is
   * still owed.
   */
  replayTranscript?: boolean;
  /**
   * Claude profile root the transcript was written under. Passed by restart
   * recovery from its ledger: this turn's own account routing may resolve a
   * different profile, but the file to read is the one the interrupted run
   * actually produced.
   */
  replayTranscriptConfigDir?: string;
  /**
   * ISO spawn time of the interrupted run whose transcript is being replayed.
   * Pins the replay to that run's own turn — see
   * `claudeCodeReplayTurnMatchesPrompt`.
   */
  replayTranscriptStartedAt?: string;
  /**
   * Prior conversation turns used to rebuild a Claude Code transcript that the
   * CLI garbage-collected (`cleanupPeriodDays`, default 30 days). Only consumed
   * when resuming and the on-disk transcript is missing — see
   * `ensureClaudeCodeResumeTranscript`. Without it, `--resume <staleId>` fails
   * with "No conversation found with session ID".
   */
  resumeReplayMessages?: HeteroSessionImportMessage[];
  sessionId: string;
  /** Extra context injected before the user prompt without mutating the prompt text. */
  systemContext?: string;
  /**
   * Topic this run belongs to. Binds the op to its in-app browser session
   * (`topic:<topicId>`) so the browser MCP tools act on the right page.
   *
   * Not to be confused with `sessionId`, which is the CC/Codex agent session —
   * a different namespace entirely.
   */
  topicId?: string;
  /** User the run belongs to; recovery only releases runs of the signed-in one. */
  userId?: string;
  /** Workspace the run belongs to; recovery only releases runs of the active one. */
  workspaceId?: string;
}

/** Mutable desktop session state shared by transport dispatch and recovery. */
export interface AgentSession {
  agentSessionId?: string;
  agentType: HeterogeneousAgentType;
  appServerSession?: CodexThreadSession;
  args: string[];
  /**
   * True when *we* initiated the kill (cancelSession / stopSession / before-quit).
   * The `exit` handler uses this to route signal-induced non-zero exits through
   * the `complete` broadcast instead of surfacing them as runtime errors —
   * SIGINT(130) / SIGTERM(143) / SIGKILL(137) from our own kill paths are
   * intentional, not agent failures.
   */
  cancelledByUs?: boolean;
  /** CLI version spawn preflight detected; decides how Claude Code gets the `lh` guide. */
  cliVersion?: string;
  codexAppServerFallback?: boolean;
  command: string;
  cursorAcpSession?: CursorAcpSession;
  cwd?: string;
  devinAcpSession?: DevinAcpSession;
  droidAcpSession?: DroidAcpSession;
  dshSession?: DshAcpSessionHandle;
  env?: Record<string, string>;
  grokAcpSession?: GrokAcpSession;
  hostedProviderBinding?: HostedProviderBinding;
  model?: string;
  modelSource?: string;
  modelVerificationLastAttemptAt?: number;
  modelVerificationLastAttemptSessionId?: string;
  /** Active pi RPC run (per-run process; cleared when the run settles). */
  piRpcSession?: PiRpcSession;
  process?: ChildProcess;
  processOwner?: { topicId?: string; agentId?: string };
  /**
   * Absolute CLI path resolved by spawn preflight detection. Used for spawn()
   * when the configured command is bare: detection can find the CLI through
   * the login-shell PATH or a well-known install location (e.g. an app-bundled
   * Codex CLI) that plain spawn() with the inherited env can't resolve.
   */
  resolvedCommandPath?: string;
  /**
   * PATH the preflight detector used to resolve `resolvedCommandPath`, set only
   * when it fell back to the login-shell PATH. Merged into the child PATH at
   * spawn so a `#!/usr/bin/env node` shim still finds its interpreter — the
   * shim resolving in preflight doesn't guarantee `node` is on the leaner
   * inherited PATH (Finder-launched Electron).
   */
  resolvedCommandSearchPath?: string;
  resumeSessionId?: string;
  sdkSession?: ClaudeAgentSdkSession;
  /** Present iff the session runs on the server-default (LobeHub) binding. */
  serverDefaultApiConfig?: HeterogeneousServerDefaultApiConfig;
  serverOperationToken?: string;
  sessionId: string;
  traeAcpSession?: TraeAcpSession;
  /**
   * Set when this turn had to rebuild a garbage-collected Claude Code
   * transcript before resuming it. The rebuild is assembled from persisted
   * chat rows, which never carried the session-scoped prompt context, so the
   * resumed transcript has not seen it even though the session id survives.
   */
  transcriptRebuiltForResume?: boolean;
  useClaudeCodeSdk?: boolean;
  useCodexAppServer?: boolean;
  verifiedModel?: string;
  verifiedModelContextWindow?: number;
  verifiedModelProvider?: string;
  verifiedModelSessionId?: string;
  verifiedModelSourceFile?: string;
}

/** Serialized trace writes for one desktop CLI run. */
export interface CliTraceSession {
  dir: string;
  writeQueue: Promise<void>;
}

/**
 * The Claude profile a session's CLI reads its transcripts from: a profile the
 * session env picked (agent env or account routing via `CLAUDE_CONFIG_DIR`),
 * else a hosted provider binding's profile, else the default `~/.claude`
 * (`undefined`). Resume recovery and replay must agree with the spawn on it.
 */
export const claudeProfileDirOf = (
  session: Pick<AgentSession, 'env' | 'hostedProviderBinding'>,
): string | undefined =>
  session.env?.CLAUDE_CONFIG_DIR ?? session.hostedProviderBinding?.profileDir;
