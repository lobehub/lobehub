import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { access, appendFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { finished as streamFinished } from 'node:stream/promises';

import type {
  ClaudeCodeQuotaSnapshot,
  CodexQuotaSnapshot,
  HeterogeneousAgentSessionError,
} from '@lobechat/electron-client-ipc';
import {
  CLAUDE_CODE_CLI_INSTALL_COMMANDS,
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_COMMANDS,
  CODEX_CLI_INSTALL_DOCS_URL,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import type { AskUserBridge } from '@lobechat/heterogeneous-agents/askUser';
import { AskUserMcpServer } from '@lobechat/heterogeneous-agents/askUser';
import type {
  AgentContentBlock,
  HeteroExecImageRef,
} from '@lobechat/heterogeneous-agents/protocol';
import { buildHeteroExecStdinPayload } from '@lobechat/heterogeneous-agents/protocol';
import type { AgentStreamEvent, UsageData } from '@lobechat/heterogeneous-agents/spawn';
import {
  AgentStreamPipeline,
  buildAgentInput,
  ClaudeAgentSdkSession,
  materializeImageToPath,
  normalizeImage,
  readCodexSessionModel,
  resolveCliSpawnPlan,
  resolveCodexInitialModel,
} from '@lobechat/heterogeneous-agents/spawn';
import { app as electronApp, BrowserWindow } from 'electron';

import { HETERO_AGENT_FILES_DIR, HETERO_AGENT_TRACING_DIR } from '@/const/heteroAgent';
import { detectHeterogeneousCliCommand } from '@/modules/binaries';
import { getHeterogeneousAgentDriver } from '@/modules/heterogeneousAgent';
import { fetchClaudeCodeQuota } from '@/modules/heterogeneousAgent/claudeCodeQuota';
import { fetchCodexQuota } from '@/modules/heterogeneousAgent/codexQuota';
import type {
  HeterogeneousAgentBuildPlan,
  HeterogeneousAgentImageAttachment,
} from '@/modules/heterogeneousAgent/types';
import { buildProxyEnv } from '@/modules/networkProxy/envBuilder';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:HeterogeneousAgentCtr');

// Anthropic auth env vars that must NOT be inherited from the desktop process
// when spawning a local CLI agent. A developer with `ANTHROPIC_API_KEY` (or an
// auth token / base url) exported in their shell would otherwise have it
// forwarded to `claude`, which then switches from its own subscription login to
// that key — an expired / wrong key surfaces as a baffling "Invalid API key"
// and the run exits non-zero. Agents that genuinely want an API key still set
// it through `session.env`, which is spread AFTER the inherited env below and
// therefore wins.
const STRIPPED_INHERITED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

/**
 * Inherited `process.env` with the Anthropic auth vars removed. Keep this pure
 * and exported so the "never leak host Anthropic creds into the CLI" invariant
 * can be unit-tested directly.
 */
export const buildInheritedSpawnEnv = (
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const env = { ...sourceEnv };
  for (const key of STRIPPED_INHERITED_ENV_KEYS) delete env[key];
  return env;
};
const CODEX_RESUME_THREAD_NOT_FOUND_PATTERNS = [
  /no conversation found/i,
  /thread .*not found/i,
  /conversation .*not found/i,
  /resume.*not found/i,
] as const;
const CLI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /authentication[_ ]error/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
] as const;
const CODEX_RESUME_CWD_MISMATCH_PATTERNS = [
  /working directory/i,
  /\bcwd\b/i,
  /different directory/i,
  /directory.*mismatch/i,
] as const;

/** Directory under appStoragePath for caching downloaded files */
const FILE_CACHE_DIR = HETERO_AGENT_FILES_DIR;
const CLI_TRACE_DIR = '.heerogeneous-tracing';
const CODEX_STDERR_STATUS_LINE = 'Reading prompt from stdin...';
const CODEX_WARN_LOG_PATTERN = /^\d{4}-\d{2}-\d{2}T\S+\s+WARN\s+/;
const CODEX_LOG_PATTERN = /^\d{4}-\d{2}-\d{2}T\S+\s+(?:DEBUG|ERROR|INFO|TRACE|WARN)\s+/;
const CLI_ERROR_LINE_PATTERN = /^(?:error:|Error:|Usage:)/;
const HETERO_SESSION_COMPLETE_GRACE_MS = 1_000;
const CLAUDE_CODE_SDK_LAB_ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const waitForHeteroSessionCompleteGrace = () =>
  new Promise<void>((resolve) => setTimeout(resolve, HETERO_SESSION_COMPLETE_GRACE_MS));

// ─── IPC types ───

interface StartSessionParams {
  /** Agent type key (e.g., 'claude-code'). Defaults to 'claude-code'. */
  agentType?: string;
  /** Additional CLI arguments */
  args?: string[];
  /** Command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Session ID to resume (for multi-turn) */
  resumeSessionId?: string;
}

interface StartSessionResult {
  sessionId: string;
}

interface SendPromptParams {
  /** Image attachments to include in the prompt (downloaded from url, cached by id) */
  imageList?: HeterogeneousAgentImageAttachment[];
  /**
   * Renderer-side operation id stamped onto every emitted `AgentStreamEvent`.
   * Required: producer-side conversion is the V3 contract — by the time events
   * reach the renderer they must already carry the operation they belong to.
   */
  operationId: string;
  prompt: string;
  sessionId: string;
  /** Extra context injected before the user prompt without mutating the prompt text. */
  systemContext?: string;
}

interface CancelSessionParams {
  sessionId: string;
}

interface SubmitInterventionParams {
  cancelled?: boolean;
  /** When set, signals user-cancelled or timeout — the bridge resolves with isError. */
  cancelReason?: 'timeout' | 'user_cancelled';
  /** Operation id stamped on the request the renderer is responding to. */
  operationId: string;
  /** Structured user answer; ignored when `cancelled` is true. */
  result?: unknown;
  /** Correlation key carried on the original `agent_intervention_request`. */
  toolCallId: string;
}

interface StopSessionParams {
  sessionId: string;
}

interface GetSessionInfoParams {
  sessionId: string;
}

interface GetCodexQuotaParams {
  command?: string;
  env?: Record<string, string>;
}

interface GetClaudeCodeQuotaParams {
  env?: Record<string, string>;
}

interface SessionInfo {
  agentSessionId?: string;
}

// ─── Internal session tracking ───

interface AgentSession {
  agentSessionId?: string;
  agentType: string;
  args: string[];
  /**
   * True when *we* initiated the kill (cancelSession / stopSession / before-quit).
   * The `exit` handler uses this to route signal-induced non-zero exits through
   * the `complete` broadcast instead of surfacing them as runtime errors —
   * SIGINT(130) / SIGTERM(143) / SIGKILL(137) from our own kill paths are
   * intentional, not agent failures.
   */
  cancelledByUs?: boolean;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  model?: string;
  modelSource?: string;
  modelVerificationLastAttemptAt?: number;
  modelVerificationLastAttemptSessionId?: string;
  process?: ChildProcess;
  /**
   * Absolute CLI path resolved by spawn preflight detection. Used for spawn()
   * when the configured command is bare: detection can find the CLI through
   * the login-shell PATH or a well-known install location (e.g. the Codex.app
   * bundled CLI) that plain spawn() with the inherited env can't resolve.
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
  sessionId: string;
  verifiedModel?: string;
  verifiedModelContextWindow?: number;
  verifiedModelProvider?: string;
  verifiedModelSessionId?: string;
  verifiedModelSourceFile?: string;
}

type SessionErrorPayload = HeterogeneousAgentSessionError | string;

interface CliTraceSession {
  dir: string;
  writeQueue: Promise<void>;
}

/**
 * External Agent Controller — manages external agent CLI processes via Electron IPC.
 *
 * Agent-agnostic: delegates spawn-plan construction and stdout framing to a
 * per-agent driver so Claude Code, Codex, and future CLIs can differ in
 * prompt transport, resume semantics, and raw stream shape without turning
 * this controller into a giant `switch`.
 *
 * Lifecycle: startSession → sendPrompt → (heteroAgentEvent broadcasts) → stopSession
 */
interface InterventionSlot {
  bridge: AskUserBridge;
  /** Resolves once bridge.events() iterator ends (after `cancelAll`). */
  pumpDone?: Promise<void>;
  /** Path to the per-op temp `mcp.json` we wrote for `--mcp-config`. */
  tmpConfigPath: string;
}

export default class HeterogeneousAgentCtr extends ControllerModule {
  static override readonly groupName = 'heterogeneousAgent';

  private sessions = new Map<string, AgentSession>();
  /**
   * Per-operation AskUserQuestion bridge state. Keyed by `operationId` so the
   * `submitIntervention` IPC can route an answer to the right pending MCP
   * handler regardless of which `sessionId` it belongs to (one session can
   * fire many ops over its lifetime).
   */
  private opIdToIntervention = new Map<string, InterventionSlot>();
  /** Lazy single MCP server, started on first claude-code prompt. */
  private askUserMcpServer?: AskUserMcpServer;
  private askUserMcpStartPromise?: Promise<AskUserMcpServer>;

  private resolveSessionCommand(session: AgentSession): string {
    const resolvedCommand = session.command.trim();
    if (resolvedCommand) return resolvedCommand;

    return session.agentType === 'codex' ? 'codex' : 'claude';
  }

  private buildCodexCliMissingError(session: AgentSession): HeterogeneousAgentSessionError {
    const command = this.resolveSessionCommand(session);

    return {
      agentType: 'codex',
      code: HeterogeneousAgentSessionErrorCode.CliNotFound,
      command,
      docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
      installCommands: CODEX_CLI_INSTALL_COMMANDS,
      message: `Codex CLI was not found. Install it and make sure \`${command}\` can be executed.`,
    };
  }

  private buildClaudeCodeCliMissingError(session: AgentSession): HeterogeneousAgentSessionError {
    const command = this.resolveSessionCommand(session);

    return {
      agentType: 'claude-code',
      code: HeterogeneousAgentSessionErrorCode.CliNotFound,
      command,
      docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
      installCommands: CLAUDE_CODE_CLI_INSTALL_COMMANDS,
      message: `Claude Code CLI was not found. Install it and make sure \`${command}\` can be executed.`,
    };
  }

  private buildCliMissingError(session: AgentSession): HeterogeneousAgentSessionError | undefined {
    switch (session.agentType) {
      case 'claude-code': {
        return this.buildClaudeCodeCliMissingError(session);
      }
      case 'codex': {
        return this.buildCodexCliMissingError(session);
      }
      default: {
        return;
      }
    }
  }

  private buildCliAuthRequiredError(
    session: AgentSession,
    stderr: string,
  ): HeterogeneousAgentSessionError | undefined {
    const command = this.resolveSessionCommand(session);

    switch (session.agentType) {
      case 'claude-code': {
        return {
          agentType: 'claude-code',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          command,
          docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
          message:
            'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
          stderr,
        };
      }
      case 'codex': {
        return {
          agentType: 'codex',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          command,
          docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
          message:
            'Codex could not authenticate. Sign in again or refresh its credentials, then retry.',
          stderr,
        };
      }
      default: {
        return;
      }
    }
  }

  private getErrorMessage(error: unknown): string | undefined {
    return typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' &&
            error &&
            'message' in error &&
            typeof error.message === 'string'
          ? error.message
          : undefined;
  }

  private buildCodexResumeError(
    code:
      | typeof HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch
      | typeof HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
    stderr: string,
    session: AgentSession,
  ): HeterogeneousAgentSessionError {
    const message =
      code === HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch
        ? 'The saved Codex thread can only be resumed from its original working directory.'
        : 'The saved Codex thread could not be found, so it can no longer be resumed.';

    return {
      agentType: 'codex',
      code,
      command: session.command,
      message,
      resumeSessionId: session.resumeSessionId,
      stderr,
      workingDirectory: session.cwd,
    };
  }

  private getCodexResumeError(
    error: unknown,
    session: AgentSession,
  ): HeterogeneousAgentSessionError | undefined {
    if (session.agentType !== 'codex' || !session.resumeSessionId) return;

    const message = this.getErrorMessage(error);

    if (!message) return;

    if (CODEX_RESUME_CWD_MISMATCH_PATTERNS.some((pattern) => pattern.test(message))) {
      return this.buildCodexResumeError(
        HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch,
        message,
        session,
      );
    }

    if (CODEX_RESUME_THREAD_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(message))) {
      return this.buildCodexResumeError(
        HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
        message,
        session,
      );
    }
  }

  private getCliAuthRequiredError(
    error: unknown,
    session: AgentSession,
  ): HeterogeneousAgentSessionError | undefined {
    const message = this.getErrorMessage(error);

    if (!message || !CLI_AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(message))) return;

    return this.buildCliAuthRequiredError(session, message);
  }

  private getSessionErrorPayload(error: unknown, session: AgentSession): SessionErrorPayload {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      const cliMissingError = this.buildCliMissingError(session);
      if (cliMissingError) return cliMissingError;
    }

    const resumeError = this.getCodexResumeError(error, session);
    if (resumeError) return resumeError;

    const authRequiredError = this.getCliAuthRequiredError(error, session);
    if (authRequiredError) return authRequiredError;

    return error instanceof Error ? error.message : String(error);
  }

  private getRelevantCodexStderr(stderr: string): string {
    const keptLines: string[] = [];
    let droppingWarnBlock = false;

    for (const line of stderr.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === CODEX_STDERR_STATUS_LINE) {
        continue;
      }

      if (CODEX_WARN_LOG_PATTERN.test(trimmed)) {
        droppingWarnBlock = true;
        continue;
      }

      if (CODEX_LOG_PATTERN.test(trimmed)) {
        droppingWarnBlock = false;
        keptLines.push(line);
        continue;
      }

      if (droppingWarnBlock && !CLI_ERROR_LINE_PATTERN.test(trimmed)) {
        continue;
      }

      droppingWarnBlock = false;
      keptLines.push(line);
    }

    return keptLines.join('\n').trim();
  }

  private getExitErrorMessage(
    code: number | null,
    session: AgentSession,
    stderrOutput: string,
  ): string {
    const relevantStderr =
      session.agentType === 'codex' ? this.getRelevantCodexStderr(stderrOutput) : stderrOutput;

    return relevantStderr || `Agent exited with code ${code}`;
  }

  private async getSpawnPreflightError(
    session: AgentSession,
  ): Promise<HeterogeneousAgentSessionError | undefined> {
    const defaultCommand =
      session.agentType === 'claude-code'
        ? 'claude'
        : session.agentType === 'codex'
          ? 'codex'
          : undefined;
    if (!defaultCommand) return;

    const command = this.resolveSessionCommand(session);
    const status =
      command === defaultCommand
        ? await this.app.binaryManager?.detect?.(defaultCommand, true)
        : await detectHeterogeneousCliCommand(
            session.agentType === 'claude-code' ? 'claude-code' : 'codex',
            command,
          );

    if (!status || status.available) {
      // Spawn through the detector-resolved absolute path when the configured
      // command is bare — detection may have located the CLI somewhere plain
      // spawn() can't (login-shell PATH, Codex.app bundled CLI, …).
      const useResolvedPath = Boolean(status?.path) && !command.includes(path.sep);
      session.resolvedCommandPath = useResolvedPath ? status!.path : undefined;
      // Carry the login-shell PATH the detector resolved through, so a
      // `#!/usr/bin/env node` shim spawned by absolute path still finds `node`.
      session.resolvedCommandSearchPath = useResolvedPath ? status!.resolvedPathEnv : undefined;
      return;
    }

    return this.buildCliMissingError(session);
  }

  private get isClaudeCodeSdkLabEnabled(): boolean {
    return CLAUDE_CODE_SDK_LAB_ENABLED_VALUES.has(
      String(process.env.LOBE_CLAUDE_CODE_SDK ?? '').toLowerCase(),
    );
  }

  private buildSessionSpawnEnv(session: AgentSession): NodeJS.ProcessEnv {
    // Forward the user's proxy settings to the CLI/SDK subprocess. The
    // main-process undici dispatcher doesn't reach child processes — they need
    // env vars.
    const proxyEnv = buildProxyEnv(this.app.storeManager.get('networkProxy'));
    const inheritedEnv = buildInheritedSpawnEnv();
    // When preflight resolved the CLI via the login-shell PATH, spawn with
    // that PATH (a superset of the inherited one) so a `#!/usr/bin/env node`
    // shim finds its interpreter. `session.env` still wins if it sets PATH.
    if (session.resolvedCommandSearchPath) inheritedEnv.PATH = session.resolvedCommandSearchPath;
    return { ...inheritedEnv, ...proxyEnv, ...session.env };
  }

  private get shouldTraceCliOutput(): boolean {
    if (process.env.NODE_ENV === 'test') return false;
    // Dev builds always trace. Packaged builds trace only when the user has
    // flipped the Help-menu developer toggle — so production issues can be
    // captured on demand without polluting normal runs.
    if (!electronApp.isPackaged) return true;
    return this.app.storeManager.get('heteroTracingEnabled', false);
  }

  /**
   * Root directory for CLI trace sessions.
   *
   * When the user has explicitly opted in via the `heteroTracingEnabled`
   * Help-menu toggle, centralize traces under the app storage dir
   * (`<appStoragePath>/heteroAgent/tracing`) — this is the only path packaged
   * builds ever trace through, and it keeps traces out of the user's real
   * project directory while staying reachable from one stable Help-menu entry.
   *
   * Otherwise (a plain dev run with the toggle off) keep writing into the
   * working directory (`cwd/.heerogeneous-tracing`) — devs expect traces to
   * show up alongside the repo they're running in.
   */
  private resolveTraceRootDir(cwd: string): string {
    if (this.app.storeManager.get('heteroTracingEnabled', false)) {
      return path.join(this.app.appStoragePath, HETERO_AGENT_TRACING_DIR);
    }
    return path.join(cwd, CLI_TRACE_DIR);
  }

  private formatTraceTimestamp(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, '0');

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      '-',
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('');
  }

  private sanitizeTracePathSegment(value: string): string {
    const sanitized = value
      .replaceAll(path.sep, '-')
      .replaceAll(/[^\w.-]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 80);

    return sanitized || 'unknown';
  }

  private getAttachmentTraceSummary(image: HeterogeneousAgentImageAttachment) {
    let urlKind = 'unknown';

    try {
      urlKind = new URL(image.url).protocol.replace(/:$/, '') || urlKind;
    } catch {
      urlKind = image.url.startsWith('data:') ? 'data' : 'unknown';
    }

    return {
      id: image.id,
      urlKind,
    };
  }

  private async createCliTraceSession({
    cliArgs,
    cwd,
    imageList,
    session,
    stdinPayload,
  }: {
    cliArgs: string[];
    cwd: string;
    imageList: HeterogeneousAgentImageAttachment[];
    session: AgentSession;
    stdinPayload?: string;
  }): Promise<CliTraceSession | undefined> {
    if (!this.shouldTraceCliOutput) return;

    // Don't materialize the cwd via mkdir — if the caller passed a stale or
    // typo'd path, we want spawn() to fail loudly instead of silently running
    // the agent in an empty auto-created directory.
    try {
      await access(cwd);
    } catch {
      return;
    }

    const createdAt = new Date();
    const rootDir = this.resolveTraceRootDir(cwd);
    const agentDir = path.join(rootDir, this.sanitizeTracePathSegment(session.agentType));
    const traceId = `${this.formatTraceTimestamp(createdAt)}-${this.sanitizeTracePathSegment(
      session.sessionId,
    )}`;
    const dir = path.join(agentDir, traceId);

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(rootDir, '.last-live-trace'), `${dir}\n`);
      await writeFile(path.join(dir, 'stdout.jsonl'), '');
      await writeFile(path.join(dir, 'stderr.log'), '');
      if (stdinPayload !== undefined) {
        await writeFile(path.join(dir, 'stdin.txt'), '');
      }
      await writeFile(
        path.join(dir, 'meta.json'),
        `${JSON.stringify(
          {
            agentSessionId: session.agentSessionId,
            agentType: session.agentType,
            args: cliArgs,
            attachments: imageList.map((image) => this.getAttachmentTraceSummary(image)),
            command: session.command,
            createdAt: createdAt.toISOString(),
            cwd,
            envKeys: session.env ? Object.keys(session.env).sort() : [],
            model: session.model,
            modelSource: session.modelSource,
            resumeSessionId: session.resumeSessionId,
            sessionId: session.sessionId,
            stdinBytes: stdinPayload === undefined ? 0 : Buffer.byteLength(stdinPayload),
            stdinFile: stdinPayload === undefined ? undefined : 'stdin.txt',
            stderrFile: 'stderr.log',
            stdoutFile: 'stdout.jsonl',
            verifiedModel: session.verifiedModel,
            verifiedModelContextWindow: session.verifiedModelContextWindow,
            verifiedModelProvider: session.verifiedModelProvider,
            verifiedModelSessionId: session.verifiedModelSessionId,
            verifiedModelSourceFile: session.verifiedModelSourceFile,
          },
          null,
          2,
        )}\n`,
      );

      return { dir, writeQueue: Promise.resolve() };
    } catch (error) {
      logger.warn('Failed to initialize CLI trace directory:', error);
    }
  }

  private queueCliTraceWrite(
    trace: CliTraceSession | undefined,
    write: () => Promise<void>,
  ): Promise<void> | undefined {
    if (!trace) return;

    trace.writeQueue = trace.writeQueue.then(write).catch((error) => {
      logger.warn('Failed to write CLI trace file:', error);
    });

    return trace.writeQueue;
  }

  private appendCliTraceFile(
    trace: CliTraceSession | undefined,
    fileName: string,
    data: Buffer | string,
  ): Promise<void> | undefined {
    if (!trace) return;

    const filePath = path.join(trace.dir, fileName);

    return this.queueCliTraceWrite(trace, () => appendFile(filePath, data));
  }

  private writeCliTraceFile(
    trace: CliTraceSession | undefined,
    fileName: string,
    data: string,
  ): Promise<void> | undefined {
    if (!trace) return;

    const filePath = path.join(trace.dir, fileName);

    return this.queueCliTraceWrite(trace, () => writeFile(filePath, data));
  }

  private writeCliTraceJson(
    trace: CliTraceSession | undefined,
    fileName: string,
    payload: unknown,
  ): Promise<void> | undefined {
    return this.writeCliTraceFile(trace, fileName, `${JSON.stringify(payload, null, 2)}\n`);
  }

  private async flushCliTrace(trace: CliTraceSession | undefined): Promise<void> {
    await trace?.writeQueue;
  }

  // ─── Broadcast ───

  private broadcast<T>(channel: string, data: T) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  // ─── AskUserQuestion MCP server () ───

  /**
   * Lazy single-instance MCP server for CC's AskUserQuestion replacement.
   * First claude-code prompt triggers `start()`; subsequent prompts reuse
   * the same listener. Concurrent first-callers de-dupe via the in-flight
   * promise so we don't bind two ports.
   */
  private async ensureAskUserMcpServerStarted(): Promise<AskUserMcpServer> {
    if (this.askUserMcpServer) return this.askUserMcpServer;
    if (!this.askUserMcpStartPromise) {
      this.askUserMcpStartPromise = (async () => {
        const server = new AskUserMcpServer();
        await server.start();
        this.askUserMcpServer = server;
        logger.info('AskUserQuestion MCP server started:', server.url);
        return server;
      })().catch((err) => {
        // Reset so a later sendPrompt can retry; surface the error.
        this.askUserMcpStartPromise = undefined;
        logger.error('Failed to start AskUserQuestion MCP server:', err);
        throw err;
      });
    }
    return this.askUserMcpStartPromise;
  }

  /**
   * Register a per-op AskUserQuestion bridge, write its temp `mcp.json`,
   * and stash it for the spawn path. The actual bridge event pump is started
   * from `handleSpawnedAgentProcess`, where it can share the stdout broadcast
   * queue instead of racing the adapter pipeline as a second producer.
   */
  private async setupInterventionForOp(
    operationId: string,
  ): Promise<{ bridge: AskUserBridge; cleanup: () => Promise<void>; tmpConfigPath: string }> {
    const server = await this.ensureAskUserMcpServerStarted();
    const bridge = server.registerOperation(operationId);
    const tmpConfigPath = path.join(os.tmpdir(), `lobe-cc-mcp-${operationId}.json`);

    // `alwaysLoad: true` is the undocumented CC flag that promotes our
    // server's tool out of the deferred set so the model calls it directly
    // (no ToolSearch hop). See spike notes — falls back to the
    // 2-hop ToolSearch path if a future CC drops the flag, no breakage.
    const config = {
      mcpServers: {
        lobe_cc: {
          alwaysLoad: true,
          type: 'http' as const,
          url: server.urlForOperation(operationId),
        },
      },
    };
    await writeFile(tmpConfigPath, JSON.stringify(config), 'utf8');

    const slot: InterventionSlot = { bridge, tmpConfigPath };
    this.opIdToIntervention.set(operationId, slot);

    const cleanup = async () => {
      // Unregistering on the server cancels all bridge pendings AND closes
      // the events iterator (cancelAll fires from within unregisterOperation).
      this.askUserMcpServer?.unregisterOperation(operationId);
      await slot.pumpDone;
      this.opIdToIntervention.delete(operationId);
      await unlink(tmpConfigPath).catch(() => {
        /* file may already be gone if app crashed mid-prompt */
      });
    };

    return { bridge, cleanup, tmpConfigPath };
  }

  // ─── File cache ───

  private get fileCacheDir(): string {
    return path.join(this.app.appStoragePath, FILE_CACHE_DIR);
  }

  /**
   * Convert a desktop image attachment list into shared content blocks. Each
   * attachment's id is preserved as the cache key so repeated prompts hit the
   * same on-disk entries.
   */
  private toImageContentBlocks(
    imageList: HeterogeneousAgentImageAttachment[],
  ): AgentContentBlock[] {
    return imageList.map((image) => ({
      source: { id: image.id, type: 'url', url: image.url },
      type: 'image',
    }));
  }

  /**
   * Build a Claude Code stream-json user message with text + base64 images.
   * Delegates to the shared `buildAgentInput`; the desktop wrapper exists only
   * to preserve the helper signature consumed by existing drivers.
   */
  private async buildStreamJsonInput(
    prompt: string,
    imageList: HeterogeneousAgentImageAttachment[] = [],
    systemContext?: string,
  ): Promise<string> {
    const blocks: AgentContentBlock[] = [];
    if (systemContext && systemContext.length > 0)
      blocks.push({ text: systemContext, type: 'text' });
    if (prompt && prompt.length > 0) blocks.push({ text: prompt, type: 'text' });
    blocks.push(...this.toImageContentBlocks(imageList));

    const plan = await buildAgentInput('claude-code', blocks, { cacheDir: this.fileCacheDir });
    return plan.stdin;
  }

  /**
   * Materialize image attachments into stable filesystem paths for path-mode
   * agents (Codex `--image <file>`). Fails the prompt if any image cannot be
   * fetched / decoded — partially-attached prompts confuse the agent more
   * than they help.
   */
  private async resolveCliImagePaths(
    imageList: HeterogeneousAgentImageAttachment[] = [],
  ): Promise<string[]> {
    if (imageList.length === 0) return [];

    const cacheDir = this.fileCacheDir;
    const results = await Promise.allSettled(
      imageList.map(async (image) => {
        const normalized = await normalizeImage(
          { id: image.id, type: 'url', url: image.url },
          { cacheDir },
        );
        return materializeImageToPath(normalized, cacheDir);
      }),
    );

    const imagePaths: string[] = [];
    const failures: string[] = [];

    for (const [index, result] of results.entries()) {
      const imageId = imageList[index]?.id ?? `image-${index + 1}`;

      if (result.status === 'fulfilled') {
        imagePaths.push(result.value);
        continue;
      }

      const message = this.getErrorMessage(result.reason) || 'Unknown error';
      logger.error(`Failed to materialize image ${imageId} for CLI:`, result.reason);
      failures.push(`${imageId}: ${message}`);
    }

    if (failures.length > 0) {
      throw new Error(`Failed to attach image(s) to CLI: ${failures.join('; ')}`);
    }

    return imagePaths;
  }

  // ─── IPC methods ───

  /**
   * Create a session (stores config, process spawned on sendPrompt).
   */
  @IpcMethod()
  async startSession(params: StartSessionParams): Promise<StartSessionResult> {
    const sessionId = randomUUID();
    const agentType = params.agentType || 'claude-code';
    getHeterogeneousAgentDriver(agentType);

    this.sessions.set(sessionId, {
      // If resuming, pre-set the agent session ID so sendPrompt adds --resume
      agentSessionId: params.resumeSessionId,
      agentType,
      args: params.args || [],
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      sessionId,
      resumeSessionId: params.resumeSessionId,
    });

    logger.info('Session created:', { agentType, sessionId });
    return { sessionId };
  }

  /**
   * Send a prompt to an agent session.
   *
   * Spawns the CLI process with preset flags. Pipes each stdout chunk through
   * the shared `AgentStreamPipeline` (JSONL → adapter → toStreamEvent) and
   * broadcasts the resulting `AgentStreamEvent`s on `heteroAgentEvent`.
   */
  @IpcMethod()
  async sendPrompt(params: SendPromptParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Session not found: ${params.sessionId}`);

    const preflightError = await this.getSpawnPreflightError(session);
    if (preflightError) {
      this.broadcast('heteroAgentSessionError', {
        error: preflightError,
        sessionId: session.sessionId,
      });
      throw new Error(preflightError.message);
    }

    if (session.agentType === 'claude-code' && this.isClaudeCodeSdkLabEnabled) {
      return this.sendPromptWithClaudeSdk(params, session);
    }

    // Stand up the AskUserQuestion MCP bridge for claude-code prompts BEFORE
    // building the spawn plan so the driver can wire the temp config path
    // into `--mcp-config`. Codex / future agents skip this entirely.
    const intervention =
      session.agentType === 'claude-code'
        ? await this.setupInterventionForOp(params.operationId).catch((err) => {
            logger.warn('Failed to set up AskUserQuestion bridge — proceeding without it:', err);
            return undefined;
          })
        : undefined;

    let spawnPlan;
    let traceSession;
    let cwd: string;
    let initialCumulativeUsage: UsageData | undefined;
    let spawnEnv: NodeJS.ProcessEnv;
    try {
      const driver = getHeterogeneousAgentDriver(session.agentType);
      spawnPlan = await driver.buildSpawnPlan({
        args: session.args,
        helpers: {
          buildClaudeStreamJsonInput: (prompt, imageList) =>
            this.buildStreamJsonInput(prompt, imageList, params.systemContext),
          resolveCliImagePaths: (imageList) => this.resolveCliImagePaths(imageList),
        },
        imageList: params.imageList ?? [],
        mcpConfigPath: intervention?.tmpConfigPath,
        prompt: params.prompt,
        resumeSessionId: session.agentSessionId,
        systemContext: params.systemContext,
      });

      // Fall back to the user's Desktop so the process never inherits
      // the Electron parent's cwd (which is `/` when launched from Finder).
      cwd = session.cwd || electronApp.getPath('desktop');

      spawnEnv = this.buildSessionSpawnEnv(session);

      if (session.agentType === 'codex') {
        const initialModel = await resolveCodexInitialModel({
          args: spawnPlan.args,
          env: spawnEnv,
        });
        if (initialModel?.model) {
          session.model = initialModel.model;
          session.modelSource = initialModel.source;
        }

        if (session.agentSessionId) {
          initialCumulativeUsage = (
            await readCodexSessionModel(session.agentSessionId, { env: spawnEnv })
          )?.cumulativeUsage;
        }
      }

      traceSession = await this.createCliTraceSession({
        cliArgs: spawnPlan.args,
        cwd,
        imageList: params.imageList ?? [],
        session,
        stdinPayload: spawnPlan.stdinPayload,
      });
    } catch (err) {
      // We never made it to spawn — the `proc.on('exit')` cleanup path
      // won't run, so tear the intervention bridge down right here.
      if (intervention) {
        await intervention.cleanup().catch((cleanupErr) => {
          logger.warn('AskUserQuestion cleanup error during pre-spawn failure:', cleanupErr);
        });
      }
      throw err;
    }
    const useStdin = spawnPlan.stdinPayload !== undefined;
    const cliArgs = spawnPlan.args;
    const resolvedCliSpawnPlan = await resolveCliSpawnPlan(
      session.resolvedCommandPath ?? session.command,
      cliArgs,
    );

    logger.info(
      'Spawning agent:',
      resolvedCliSpawnPlan.command,
      resolvedCliSpawnPlan.args.join(' '),
      `(cwd: ${cwd})`,
    );

    // `detached: true` on Unix puts the child in a new process group so we
    // can SIGINT/SIGKILL the whole tree (claude + any tool subprocesses)
    // via `process.kill(-pid, sig)` on cancel. Without this, SIGINT to just
    // the claude binary can leave bash/grep/etc. tool children running and
    // the CLI hung waiting on them. Windows has different semantics — use
    // taskkill /T /F there; no detached flag needed.
    const spawnOptions = {
      cwd,
      detached: process.platform !== 'win32',
      // Strip host Anthropic creds from the inherited env so a developer's
      // shell `ANTHROPIC_API_KEY` can't hijack the CLI's own auth. `session.env`
      // is spread last, so an agent that explicitly configures a key still wins.
      env: spawnEnv,
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] as ['pipe' | 'ignore', 'pipe', 'pipe'],
    };

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(resolvedCliSpawnPlan.command, resolvedCliSpawnPlan.args, spawnOptions);
      this.handleSpawnedAgentProcess({
        cwd,
        intervention,
        params,
        proc,
        reject,
        resolve,
        session,
        initialCumulativeUsage,
        spawnEnv,
        traceSession,
        useStdin,
        spawnPlan,
      });
    });
  }

  private async sendPromptWithClaudeSdk(
    params: SendPromptParams,
    session: AgentSession,
  ): Promise<void> {
    const cwd = session.cwd || electronApp.getPath('desktop');
    const spawnEnv = this.buildSessionSpawnEnv(session);
    const commandPath = session.resolvedCommandPath ?? this.resolveSessionCommand(session);
    const stdinPayload = await this.buildStreamJsonInput(
      params.prompt,
      params.imageList ?? [],
      params.systemContext,
    );
    const traceSession = await this.createCliTraceSession({
      cliArgs: ['sdk-stream', ...session.args],
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload,
    });

    void this.writeCliTraceFile(traceSession, 'stdin.txt', stdinPayload);

    const sdkSession = new ClaudeAgentSdkSession({
      args: session.args,
      commandPath,
      cwd,
      env: spawnEnv,
      onEvents: async (events) => {
        for (const event of events) {
          this.broadcast('heteroAgentEvent', {
            event,
            sessionId: session.sessionId,
          });
        }
      },
      onRawMessage: (line) => this.appendCliTraceFile(traceSession, 'stdout.jsonl', line),
      onRuntimeStatus: (status) => {
        this.broadcast('heteroAgentRuntimeStatus', status);
      },
      onSessionId: (agentSessionId) => {
        if (agentSessionId !== session.agentSessionId) session.agentSessionId = agentSessionId;
      },
      onStderr: (data) => this.appendCliTraceFile(traceSession, 'stderr.log', data),
      operationId: params.operationId,
      resumeSessionId: session.agentSessionId,
      sessionId: session.sessionId,
      stdinPayload,
    });

    session.sdkSession = sdkSession;

    logger.info('Starting Claude Code SDK session:', {
      commandPath,
      cwd,
      sessionId: session.sessionId,
    });

    try {
      await sdkSession.run();
      session.sdkSession = undefined;
      void this.writeCliTraceJson(traceSession, 'exit.json', {
        finishedAt: new Date().toISOString(),
        transport: 'claude-sdk',
      });
      await this.flushCliTrace(traceSession);
      this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
    } catch (error) {
      session.sdkSession = undefined;
      logger.error('Claude SDK session error:', error);
      void this.writeCliTraceJson(traceSession, 'process-error.json', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Error',
        transport: 'claude-sdk',
      });
      await this.flushCliTrace(traceSession);

      if (session.cancelledByUs) {
        this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
        return;
      }

      const sessionError = this.getSessionErrorPayload(error, session);
      this.broadcast('heteroAgentSessionError', {
        error: sessionError,
        sessionId: session.sessionId,
      });
      throw new Error(typeof sessionError === 'string' ? sessionError : sessionError.message, {
        cause: error,
      });
    }
  }

  private async verifyCodexSessionModel({
    env,
    pipeline,
    session,
    traceSession,
  }: {
    env: NodeJS.ProcessEnv;
    pipeline: AgentStreamPipeline;
    session: AgentSession;
    traceSession: CliTraceSession | undefined;
  }): Promise<AgentStreamEvent[]> {
    if (
      session.agentType !== 'codex' ||
      !pipeline.sessionId ||
      session.verifiedModelSessionId === pipeline.sessionId
    ) {
      return [];
    }

    const now = Date.now();
    if (
      session.modelVerificationLastAttemptSessionId === pipeline.sessionId &&
      session.modelVerificationLastAttemptAt &&
      now - session.modelVerificationLastAttemptAt < 1000
    ) {
      return [];
    }
    session.modelVerificationLastAttemptSessionId = pipeline.sessionId;
    session.modelVerificationLastAttemptAt = now;

    const sessionModel = await readCodexSessionModel(pipeline.sessionId, { env });
    if (!sessionModel?.model) return [];

    const previousModel = session.model;
    session.verifiedModel = sessionModel.model;
    session.verifiedModelContextWindow = sessionModel.contextWindow;
    session.verifiedModelProvider = sessionModel.provider;
    session.verifiedModelSessionId = pipeline.sessionId;
    session.verifiedModelSourceFile = sessionModel.sourceFile;

    void this.writeCliTraceJson(traceSession, 'model.json', {
      initialModel: previousModel,
      initialModelSource: session.modelSource,
      sessionId: pipeline.sessionId,
      verifiedAt: new Date().toISOString(),
      verifiedContextWindow: sessionModel.contextWindow,
      verifiedLine: sessionModel.line,
      verifiedModel: sessionModel.model,
      verifiedModelProvider: sessionModel.provider,
      verifiedSourceFile: sessionModel.sourceFile,
    });

    if (previousModel === sessionModel.model) return [];

    session.model = sessionModel.model;
    session.modelSource = 'codex-session';
    return pipeline.configureSession({ model: sessionModel.model });
  }

  private handleSpawnedAgentProcess({
    cwd,
    initialCumulativeUsage,
    intervention,
    params,
    proc,
    reject,
    resolve,
    session,
    spawnEnv,
    spawnPlan,
    traceSession,
    useStdin,
  }: {
    cwd: string;
    intervention?: Awaited<ReturnType<HeterogeneousAgentCtr['setupInterventionForOp']>>;
    params: SendPromptParams;
    proc: ChildProcess;
    reject: (reason?: unknown) => void;
    resolve: () => void;
    session: AgentSession;
    initialCumulativeUsage?: UsageData | undefined;
    spawnEnv: NodeJS.ProcessEnv;
    spawnPlan: HeterogeneousAgentBuildPlan;
    traceSession: CliTraceSession | undefined;
    useStdin: boolean;
  }) {
    proc.on('error', (err) => {
      logger.error('Agent process error:', err);
      void this.writeCliTraceJson(traceSession, 'process-error.json', {
        message: err.message,
        name: err.name,
      });
      void this.flushCliTrace(traceSession);
      const sessionError = this.getSessionErrorPayload(err, session);
      this.broadcast('heteroAgentSessionError', {
        error: sessionError,
        sessionId: session.sessionId,
      });
      reject(new Error(typeof sessionError === 'string' ? sessionError : sessionError.message));
    });

    // In stdin mode, write the prepared payload and close stdin.
    if (useStdin && spawnPlan.stdinPayload !== undefined && proc.stdin) {
      void this.writeCliTraceFile(traceSession, 'stdin.txt', spawnPlan.stdinPayload);
      const stdin = proc.stdin as Writable;
      stdin.write(spawnPlan.stdinPayload, () => {
        stdin.end();
      });
    }

    session.process = proc;

    // Producer-side conversion (V3 contract): JSONL framing + adapter +
    // toStreamEvent all run inside the shared pipeline, so renderer + future
    // server `heteroIngest` see the same `AgentStreamEvent` wire shape with
    // no per-consumer adapter. The pipeline auto-wires the Codex
    // file-change diff/stat tracker when `agentType === 'codex'`, so this
    // controller stays agent-agnostic.
    const pipeline = new AgentStreamPipeline({
      agentType: session.agentType,
      cwd,
      initialCumulativeUsage,
      initialModel: session.model,
      operationId: params.operationId,
    });
    let stdoutBroadcastQueue: Promise<void> = Promise.resolve();

    const broadcastStreamEvents = (events: AgentStreamEvent[]) => {
      for (const event of events) {
        this.broadcast('heteroAgentEvent', {
          event,
          sessionId: session.sessionId,
        });
      }
    };

    const broadcastPipelineBatch = (produce: () => ReturnType<AgentStreamPipeline['push']>) => {
      stdoutBroadcastQueue = stdoutBroadcastQueue
        .then(async () => {
          const events = await produce();
          // Adapter-extracted CC/Codex session id powers `--resume` on the
          // next prompt; surface it through the existing `getSessionInfo`
          // IPC by mirroring the freshest value onto the session record.
          if (pipeline.sessionId && pipeline.sessionId !== session.agentSessionId) {
            session.agentSessionId = pipeline.sessionId;
          }
          events.push(
            ...(await this.verifyCodexSessionModel({
              env: spawnEnv,
              pipeline,
              session,
              traceSession,
            })),
          );
          broadcastStreamEvents(events);
        })
        .catch((error) => {
          logger.error('Failed to broadcast agent stream batch:', error);
        });
    };

    const broadcastBridgeEvent = (event: AgentStreamEvent) => {
      stdoutBroadcastQueue = stdoutBroadcastQueue
        .then(() => {
          broadcastStreamEvents([event]);
        })
        .catch((error) => {
          logger.error('Failed to broadcast AskUserQuestion bridge event:', error);
        });
    };

    if (intervention) {
      const pumpDone = (async () => {
        for await (const event of intervention.bridge.events()) {
          broadcastBridgeEvent(event);
        }
        await stdoutBroadcastQueue;
      })().catch((err) => {
        logger.warn('AskUserQuestion bridge pump error:', err);
      });
      const slot = this.opIdToIntervention.get(params.operationId);
      if (slot) slot.pumpDone = pumpDone;
    }

    // Stream stdout events through the producer pipeline.
    const stdout = proc.stdout as Readable;
    stdout.on('data', (chunk: Buffer) => {
      void this.appendCliTraceFile(traceSession, 'stdout.jsonl', chunk);
      broadcastPipelineBatch(() => pipeline.push(chunk));
    });
    stdout.on('end', () => {
      broadcastPipelineBatch(() => pipeline.flush());
    });

    // Capture stderr
    const stderrChunks: string[] = [];
    const stderr = proc.stderr as Readable;
    stderr.on('data', (chunk: Buffer) => {
      void this.appendCliTraceFile(traceSession, 'stderr.log', chunk);
      stderrChunks.push(chunk.toString('utf8'));
    });

    proc.on('exit', (code, signal) => {
      // Node may emit `'exit'` BEFORE stdio finishes draining (documented:
      // child_process docs note "stdio streams might still be open" at exit
      // time). Wait for stdout to fully end/close so the `stdout.on('end')`
      // handler has scheduled `pipeline.flush()` onto `stdoutBroadcastQueue`,
      // THEN wait for the queue itself to settle. Without this two-step
      // gate, trailing flushed events (final synthesized tool_end /
      // tool_result) would race against — and lose to — the
      // `heteroAgentSessionComplete` broadcast, leaving renderer-side
      // persistence to finalize on incomplete state.
      const stdoutDrained = streamFinished(stdout, { writable: false }).catch(() => {
        /* end / close / error are all "done"; we still want to settle. */
      });

      void stdoutDrained
        .then(() => stdoutBroadcastQueue)
        .finally(async () => {
          // Tear down the AskUserQuestion bridge / temp `mcp.json` for this
          // op. Pending MCP handlers get a `session_ended` cancellation so
          // they return cleanly even if CC was killed mid-tool-call.
          if (intervention) {
            await intervention.cleanup().catch((err) => {
              logger.warn('AskUserQuestion cleanup error:', err);
            });
          }

          void this.writeCliTraceJson(traceSession, 'exit.json', {
            code,
            finishedAt: new Date().toISOString(),
            signal,
          });
          await this.flushCliTrace(traceSession);
          await waitForHeteroSessionCompleteGrace();

          logger.info('Agent process exited:', { code, sessionId: session.sessionId, signal });
          session.process = undefined;

          // If *we* killed it (cancel / stop / before-quit), treat the non-zero
          // exit as a clean shutdown — surfacing it as an error would make a
          // user-initiated cancel look like an agent failure, and an Electron
          // shutdown affecting OTHER running CC sessions would pollute their
          // topics with a misleading "Agent exited with code 143" message.
          if (session.cancelledByUs) {
            this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
            resolve();
            return;
          }

          if (code === 0) {
            this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
            resolve();
          } else {
            const stderrOutput = stderrChunks.join('').trim();
            const errorMsg = this.getExitErrorMessage(code, session, stderrOutput);
            const sessionError = this.getSessionErrorPayload(errorMsg, session);
            this.broadcast('heteroAgentSessionError', {
              error: sessionError,
              sessionId: session.sessionId,
            });
            reject(
              new Error(typeof sessionError === 'string' ? sessionError : sessionError.message),
            );
          }
        });
    });
  }

  /**
   * Get session info (agent's internal session ID for multi-turn resume).
   */
  @IpcMethod()
  async getSessionInfo(params: GetSessionInfoParams): Promise<SessionInfo> {
    const session = this.sessions.get(params.sessionId);
    return { agentSessionId: session?.agentSessionId };
  }

  @IpcMethod()
  async getCodexQuota(params: GetCodexQuotaParams = {}): Promise<CodexQuotaSnapshot> {
    const command = params.command?.trim() || 'codex';
    const status = await detectHeterogeneousCliCommand('codex', command);
    const env = {
      ...(status.resolvedPathEnv ? { PATH: status.resolvedPathEnv } : {}),
      ...buildProxyEnv(this.app.storeManager.get('networkProxy')),
      ...params.env,
    };

    return fetchCodexQuota({
      command: status.available && status.path ? status.path : command,
      env: Object.keys(env).length > 0 ? env : undefined,
    });
  }

  /**
   * Read the Claude Code subscription quota. No CLI is spawned: the quota
   * comes from Anthropic's OAuth usage API using the local `claude` login,
   * and the request goes through the app's global proxy dispatcher.
   */
  @IpcMethod()
  async getClaudeCodeQuota(
    params: GetClaudeCodeQuotaParams = {},
  ): Promise<ClaudeCodeQuotaSnapshot> {
    return fetchClaudeCodeQuota({ env: params.env });
  }

  /**
   * Signal the whole process tree spawned by this session.
   *
   * On Unix the child was spawned with `detached: true`, so negating the pid
   * signals the process group — reaching tool subprocesses (bash, grep, etc.)
   * that would otherwise orphan after a parent-only kill. Falls back to the
   * direct signal if the group kill raises (ESRCH when the leader is already
   * gone). On Windows we shell out to `taskkill /T /F` which walks the tree.
   */
  private killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (!proc.pid || proc.killed) return;

    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (err) {
        logger.warn('taskkill failed:', err);
      }
      return;
    }

    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        // already exited
      }
    }
  }

  /**
   * Cancel an ongoing session: SIGINT the CC tree, escalate to SIGKILL after
   * 2s if the CLI hasn't exited (some tool calls swallow SIGINT). The
   * `exit` handler on the spawned proc broadcasts completion and clears
   * `session.process`, so the escalation is a no-op when the graceful path
   * already landed.
   */
  @IpcMethod()
  async cancelSession(params: CancelSessionParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;

    session.cancelledByUs = true;
    if (session.sdkSession) {
      session.sdkSession.close();
      return;
    }

    if (!session.process || session.process.killed) return;
    const proc = session.process;
    this.killProcessTree(proc, 'SIGINT');

    setTimeout(() => {
      if (session.process === proc && !proc.killed) {
        logger.warn('Session did not exit after SIGINT, escalating to SIGKILL:', params.sessionId);
        this.killProcessTree(proc, 'SIGKILL');
      }
    }, 2000);
  }

  /**
   * Stop and clean up a session.
   */
  @IpcMethod()
  async stopSession(params: StopSessionParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;

    if (session.sdkSession) {
      session.cancelledByUs = true;
      session.sdkSession.close();
    }

    if (session.process && !session.process.killed) {
      session.cancelledByUs = true;
      const proc = session.process;
      this.killProcessTree(proc, 'SIGTERM');
      setTimeout(() => {
        if (session.process === proc && !proc.killed) {
          this.killProcessTree(proc, 'SIGKILL');
        }
      }, 3000);
    }

    this.sessions.delete(params.sessionId);
  }

  @IpcMethod()
  async respondPermission(): Promise<void> {
    // No-op for CLI mode (permissions handled by --permission-mode flag)
  }

  /**
   * Renderer → main: deliver the user's answer to a pending CC AskUserQuestion
   * (or signal cancellation). The matching bridge resolves its blocked
   * `pending()` Promise, the local MCP handler returns to CC, and CC's
   * `tool_result` flows back through the normal stream pipeline.
   *
   * Idempotent — late submissions for already-resolved tool calls are no-ops.
   * No-op when called for an unknown opId; the bridge may have been cleaned
   * up already (op finished / cancelled).
   */
  @IpcMethod()
  async submitIntervention(params: SubmitInterventionParams): Promise<void> {
    const slot = this.opIdToIntervention.get(params.operationId);
    if (!slot) {
      logger.warn('submitIntervention: no active intervention for operationId', params.operationId);
      return;
    }
    slot.bridge.resolve(params.toolCallId, {
      cancelReason: params.cancelled ? (params.cancelReason ?? 'user_cancelled') : undefined,
      cancelled: params.cancelled,
      result: params.result,
    });
  }

  /**
   * Synchronously unlink every pending intervention's temp `mcp.json`. The
   * async exit-handler cleanup loses to Electron's main-process teardown
   * often enough that we'd leak `lobe-cc-mcp-<opId>.json` files into
   * `os.tmpdir()` on real shutdowns; sync unlink here is the only reliable
   * guarantee. Safe to call multiple times.
   */
  private unlinkPendingInterventionConfigsSync = (): void => {
    for (const [, intervention] of this.opIdToIntervention) {
      try {
        unlinkSync(intervention.tmpConfigPath);
      } catch {
        /* file may already be gone — fine */
      }
    }
  };

  /**
   * Cleanup on app quit. `before-quit` covers the user-driven Cmd+Q /
   * `app.quit()` path; SIGTERM / SIGINT cover external kills (test
   * harnesses, OS shutdown) where Electron's lifecycle events never fire.
   */
  afterAppReady() {
    electronApp.on('before-quit', () => {
      this.unlinkPendingInterventionConfigsSync();
      for (const [, session] of this.sessions) {
        if (session.sdkSession) {
          session.cancelledByUs = true;
          session.sdkSession.close();
        }
        if (session.process && !session.process.killed) {
          session.cancelledByUs = true;
          this.killProcessTree(session.process, 'SIGTERM');
        }
      }
      this.sessions.clear();
      // The exit handlers will tear each per-op intervention down, but if
      // CC's stdio close races shutdown we'd leave the MCP server bound to
      // a port. Stopping it here cancels every still-pending bridge with
      // `session_ended` and closes the listener.
      void this.askUserMcpServer?.stop().catch((err) => {
        logger.warn('AskUserQuestion MCP server stop error:', err);
      });
    });

    const onSignal = (signal: NodeJS.Signals) => {
      this.unlinkPendingInterventionConfigsSync();
      // Defer to Electron's normal quit flow so the rest of the app gets a
      // chance to tear down. The `before-quit` handler above is idempotent.
      try {
        electronApp.quit();
      } catch {
        /* during late shutdown app.quit may throw — fine */
      }
      // Last-resort exit if Electron is wedged and won't quit on its own.
      setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 1000).unref();
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
  }

  /**
   * Spawn `lh hetero exec` for gateway-driven agent runs.
   * The `lh` CLI handles everything downstream — no local
   * AgentStreamPipeline or IPC broadcast needed. Mirrors
   * `spawnHeteroSandbox()` on the server side.
   */
  spawnLhHeteroExec(params: {
    agentType: string;
    /** Resolved `lh hetero exec` wrapper args. */
    args?: string[];
    cwd?: string;
    /** Image attachments (signed URLs) appended as image content blocks. */
    imageList?: HeteroExecImageRef[];
    jwt: string;
    operationId: string;
    prompt: string;
    resumeSessionId?: string;
    serverUrl: string;
    systemContext?: string;
    topicId: string;
  }): void {
    const {
      agentType,
      args: extraArgs,
      cwd,
      imageList,
      jwt,
      operationId,
      prompt,
      resumeSessionId,
      serverUrl,
      systemContext,
      topicId,
    } = params;
    const workDir = cwd ?? process.cwd();

    // When CLI tracing is enabled (dev builds, or the Help-menu toggle in
    // packaged builds), have `lh hetero exec` persist the agent process's RAW
    // stream-json (pre-adapter) on this device. The remote-device path
    // otherwise leaves no local record — the CLI consumes stdout internally and
    // only POSTs adapted events to the server — so without this there's nothing
    // to inspect when a remote run misbehaves.
    const rawDumpDir = this.shouldTraceCliOutput ? this.resolveTraceRootDir(workDir) : undefined;

    const args = [
      'hetero',
      'exec',
      '--type',
      agentType,
      '--operation-id',
      operationId,
      '--topic',
      topicId,
      '--render',
      'none',
      '--input-json',
      '-',
      '--cwd',
      workDir,
      ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
      ...(rawDumpDir ? ['--raw-dump', rawDumpDir] : []),
      ...(extraArgs ?? []),
    ];

    const env = {
      ...process.env,
      ...buildProxyEnv(this.app.storeManager.get('networkProxy')),
      LOBEHUB_JWT: jwt,
      LOBEHUB_SERVER: serverUrl,
    };

    logger.info('spawnLhHeteroExec: type=%s op=%s topic=%s', agentType, operationId, topicId);

    const child = spawn('lh', args, {
      cwd: workDir,
      env,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    // systemContext / image attachments turn the payload into a content-block
    // array so CC sees the context block first, then the user's message, then
    // the images — mirrors spawnHeteroSandbox. lh handles both shapes via
    // coerceJsonPrompt, so no lh changes are required.
    const stdinPayload = buildHeteroExecStdinPayload({ imageList, prompt, systemContext });
    child.stdin.write(stdinPayload);
    child.stdin.end();

    child.on('error', (err) => {
      logger.error('spawnLhHeteroExec: spawn failed — %s', err.message);
    });

    child.on('exit', (code, signal) => {
      logger.info('spawnLhHeteroExec: exited — op=%s code=%s signal=%s', operationId, code, signal);
    });
  }
}
