import type { ChildProcess } from 'node:child_process';

import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type { AskUserBridge, AskUserBridgeOptions } from '@lobechat/heterogeneous-agents/askUser';
import { buildHeterogeneousPrompt } from '@lobechat/heterogeneous-agents/protocol';
import type { PiRpcSession } from '@lobechat/heterogeneous-agents/rpc';
import type {
  ClaudeAgentSdkSession,
  CodexThreadSession,
  DshAcpSessionHandle,
} from '@lobechat/heterogeneous-agents/spawn';
import {
  AcpRpcResponseError,
  buildCopilotAcpArgs,
  buildCopilotAcpPrompt,
  buildCursorAcpArgs,
  buildCursorAcpPrompt,
  buildDevinAcpArgs,
  buildDevinAcpPrompt,
  buildDroidAcpArgs,
  buildDroidAcpPrompt,
  buildGrokAcpArgs,
  buildGrokAcpPrompt,
  buildTraeAcpArgs,
  buildTraeAcpPrompt,
  CopilotAcpSession,
  CursorAcpSession,
  DevinAcpSession,
  DroidAcpSession,
  GrokAcpSession,
  isCopilotAcpSessionNotFoundError,
  isCursorAcpSessionNotFoundError,
  isDevinAcpSessionNotFoundError,
  isDroidAcpSessionNotFoundError,
  TraeAcpSession,
} from '@lobechat/heterogeneous-agents/spawn';
import type {
  HeterogeneousServerDefaultApiConfig,
  HeteroSessionImportMessage,
} from '@lobechat/types';
import { app as electronApp } from 'electron';
import { isPlainObject } from 'es-toolkit';

import type { HostedProviderBinding } from '@/modules/heterogeneousAgent/providerBindingHost';
import type { HeterogeneousAgentImageAttachment } from '@/modules/heterogeneousAgent/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('controllers:HeterogeneousAgentCtr');

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
  copilotAcpSession?: CopilotAcpSession;
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

export const getAcpResumeError = (
  error: unknown,
  session: AgentSession,
): HeterogeneousAgentSessionError | undefined => {
  if (!session.resumeSessionId) return;

  if (session.agentType === 'copilot' && isCopilotAcpSessionNotFoundError(error)) {
    return {
      agentType: 'copilot',
      code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
      command: session.command,
      details: {
        code: error.rpcError.code,
        data: error.rpcError.data,
      },
      message:
        'The saved GitHub Copilot session could not be found, so a new conversation will start.',
      resumeSessionId: session.resumeSessionId,
      stderr: error.message,
      workingDirectory: session.cwd,
    };
  }

  if (session.agentType === 'cursor' && isCursorAcpSessionNotFoundError(error)) {
    return {
      agentType: 'cursor',
      code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
      command: session.command,
      details: {
        code: error.rpcError.code,
        message: error.rpcError.message,
      },
      message:
        'The saved Cursor session cannot be loaded through ACP, so a new conversation will start.',
      resumeSessionId: session.resumeSessionId,
      stderr: error.message,
      workingDirectory: session.cwd,
    };
  }

  if (session.agentType === 'devin' && isDevinAcpSessionNotFoundError(error)) {
    return {
      agentType: 'devin',
      code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
      command: session.command,
      details: {
        code: error.rpcError.code,
        data: error.rpcError.data,
      },
      message: 'The saved Devin session could not be found, so a new conversation will start.',
      resumeSessionId: session.resumeSessionId,
      stderr: error.message,
      workingDirectory: session.cwd,
    };
  }

  if (session.agentType === 'droid' && isDroidAcpSessionNotFoundError(error)) {
    return {
      agentType: 'droid',
      code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
      command: session.command,
      details: {
        code: error.rpcError.code,
        data: error.rpcError.data,
      },
      message:
        'The saved Factory Droid session could not be found, so a new conversation will start.',
      resumeSessionId: session.resumeSessionId,
      stderr: error.message,
      workingDirectory: session.cwd,
    };
  }

  if (
    session.agentType === 'grok-build' &&
    error instanceof AcpRpcResponseError &&
    error.method === 'session/load' &&
    isPlainObject(error.rpcError.data) &&
    error.rpcError.data.code === 'FS_NOT_FOUND'
  ) {
    return {
      agentType: 'grok-build',
      code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
      command: session.command,
      details: {
        code: error.rpcError.code,
        data: error.rpcError.data,
      },
      message: 'The saved Grok Build session could not be found, so it can no longer be resumed.',
      resumeSessionId: session.resumeSessionId,
      stderr: error.message,
      workingDirectory: session.cwd,
    };
  }
};

export const interruptActiveAcpSession = async (session: AgentSession): Promise<boolean> => {
  if (session.copilotAcpSession) {
    session.copilotAcpSession.interrupt();
    return true;
  }
  if (session.devinAcpSession) {
    session.devinAcpSession.interrupt();
    return true;
  }
  if (session.grokAcpSession) {
    session.grokAcpSession.interrupt();
    return true;
  }
  if (session.cursorAcpSession) {
    session.cursorAcpSession.interrupt();
    return true;
  }
  if (session.droidAcpSession) {
    session.droidAcpSession.interrupt();
    return true;
  }
  if (session.traeAcpSession) {
    await session.traeAcpSession.interrupt();
    return true;
  }
  return false;
};

export const closeActiveAcpSessions = (session: AgentSession): void => {
  for (const active of [
    session.copilotAcpSession,
    session.devinAcpSession,
    session.grokAcpSession,
    session.cursorAcpSession,
    session.droidAcpSession,
    session.traeAcpSession,
  ]) {
    if (active) {
      session.cancelledByUs = true;
      active.close();
    }
  }
};

export interface AcpSessionHost {
  appendCliTraceFile: (
    trace: CliTraceSession | undefined,
    name: string,
    data: string,
  ) => Promise<void> | undefined;
  broadcast: <T>(channel: string, data: T) => void;
  buildSessionSpawnEnv: (session: AgentSession) => NodeJS.ProcessEnv;
  completeCancelledSessionBeforeLaunch: (session: AgentSession) => Promise<void>;
  createCliTraceSession: (args: {
    cliArgs: string[];
    cwd: string;
    imageList: NonNullable<SendPromptParams['imageList']>;
    session: AgentSession;
    stdinPayload: string;
  }) => Promise<CliTraceSession | undefined>;
  fileCacheDir: string;
  flushCliTrace: (trace: CliTraceSession | undefined) => Promise<void>;
  getErrorMessage: (error: unknown) => string | undefined;
  getSessionErrorPayload: (
    error: unknown,
    session: AgentSession,
  ) => HeterogeneousAgentSessionError | string;
  needsSessionIntroduction: (session: AgentSession) => boolean;
  resolveSessionCommand: (session: AgentSession) => string;
  resolveSessionWorkingDirectory: (session: AgentSession) => string;
  setupAcpInterventionForOp: (
    operationId: string,
    sessionId: string,
    provider: NonNullable<AskUserBridgeOptions['provider']>,
  ) => {
    bridge: AskUserBridge;
    cleanup: () => Promise<void>;
  };
  writeCliTraceFile: (
    trace: CliTraceSession | undefined,
    name: string,
    data: string,
  ) => Promise<void> | undefined;
  writeCliTraceJson: (
    trace: CliTraceSession | undefined,
    name: string,
    payload: unknown,
  ) => Promise<void> | undefined;
}

interface InteractiveAcpSession {
  run: () => Promise<void>;
}

const runInteractiveAcpSession = async (
  host: AcpSessionHost,
  {
    acpSession,
    activeSessionKey,
    cleanup,
    isResumeError,
    session,
    stderrChunks,
    traceSession,
    transport,
  }: {
    acpSession: InteractiveAcpSession;
    activeSessionKey:
      | 'copilotAcpSession'
      | 'cursorAcpSession'
      | 'devinAcpSession'
      | 'droidAcpSession'
      | 'traeAcpSession';
    cleanup?: () => Promise<void>;
    isResumeError?: (error: unknown) => boolean;
    session: AgentSession;
    stderrChunks: string[];
    traceSession: CliTraceSession | undefined;
    transport: 'copilot-acp' | 'cursor-acp' | 'devin-acp' | 'droid-acp' | 'trae-acp';
  },
): Promise<void> => {
  try {
    await acpSession.run();
    void host.writeCliTraceJson(traceSession, 'exit.json', {
      finishedAt: new Date().toISOString(),
      transport,
    });
    await host.flushCliTrace(traceSession);
    host.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
  } catch (error) {
    void host.writeCliTraceJson(traceSession, 'process-error.json', {
      message: host.getErrorMessage(error),
      transport,
    });
    await host.flushCliTrace(traceSession);
    if (session.cancelledByUs) {
      host.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
      return;
    }
    const stderr = stderrChunks.join('').trim();
    const errorForClassification = isResumeError?.(error)
      ? error
      : stderr
        ? new Error([host.getErrorMessage(error), stderr].filter(Boolean).join('\n'), {
            cause: error,
          })
        : error;
    const sessionError = host.getSessionErrorPayload(errorForClassification, session);
    host.broadcast('heteroAgentSessionError', {
      error: sessionError,
      sessionId: session.sessionId,
    });
    throw new Error(typeof sessionError === 'string' ? sessionError : sessionError.message, {
      cause: error,
    });
  } finally {
    await cleanup?.();
    if (activeSessionKey === 'copilotAcpSession' && session.copilotAcpSession === acpSession) {
      session.copilotAcpSession = undefined;
    } else if (activeSessionKey === 'cursorAcpSession' && session.cursorAcpSession === acpSession) {
      session.cursorAcpSession = undefined;
    } else if (activeSessionKey === 'devinAcpSession' && session.devinAcpSession === acpSession) {
      session.devinAcpSession = undefined;
    } else if (activeSessionKey === 'droidAcpSession' && session.droidAcpSession === acpSession) {
      session.droidAcpSession = undefined;
    } else if (activeSessionKey === 'traeAcpSession' && session.traeAcpSession === acpSession) {
      session.traeAcpSession = undefined;
    }
  }
};

export const sendPromptWithAcpSession = async (
  host: AcpSessionHost,
  params: SendPromptParams,
  session: AgentSession,
): Promise<void> => {
  const spawnEnv = host.buildSessionSpawnEnv(session);
  const commandPath = session.resolvedCommandPath ?? host.resolveSessionCommand(session);
  const promptInput = buildHeterogeneousPrompt({
    imageList: params.imageList,
    isNewSession: host.needsSessionIntroduction(session),
    prompt: params.prompt,
    systemContext: params.systemContext,
  });

  if (session.agentType === 'grok-build') {
    const cwd = session.cwd || electronApp.getPath('desktop');
    let prompt;
    try {
      prompt = await buildGrokAcpPrompt(promptInput, { cacheDir: host.fileCacheDir });
    } catch (error) {
      logger.error('Failed to prepare Grok Build ACP input:', error);
      throw new Error(
        `Failed to attach image(s) to Grok Build: ${host.getErrorMessage(error) || 'Unknown error'}`,
        { cause: error },
      );
    }

    const traceInput = `${JSON.stringify(prompt)}\n`;
    const traceSession = await host.createCliTraceSession({
      cliArgs: buildGrokAcpArgs(session.args),
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload: traceInput,
    });
    void host.writeCliTraceFile(traceSession, 'stdin.txt', traceInput);

    if (session.cancelledByUs) {
      await host.completeCancelledSessionBeforeLaunch(session);
      return;
    }

    const acpSession = new GrokAcpSession({
      args: session.args,
      clientVersion: electronApp.getVersion(),
      commandPath,
      cwd,
      env: spawnEnv,
      onEvents: async (events) => {
        for (const event of events) {
          host.broadcast('heteroAgentEvent', { event, sessionId: session.sessionId });
        }
      },
      onRawMessage: (line) => host.appendCliTraceFile(traceSession, 'stdout.jsonl', line),
      onRuntimeStatus: (status) => host.broadcast('heteroAgentRuntimeStatus', status),
      onSessionId: (agentSessionId) => {
        if (agentSessionId !== session.agentSessionId) session.agentSessionId = agentSessionId;
      },
      onStderr: (data) => host.appendCliTraceFile(traceSession, 'stderr.log', data),
      operationId: params.operationId,
      prompt,
      resumeSessionId: session.agentSessionId,
      sessionId: session.sessionId,
    });
    session.grokAcpSession = acpSession;

    logger.info('Starting Grok Build ACP session:', {
      commandPath,
      cwd,
      sessionId: session.sessionId,
    });

    try {
      await acpSession.run();
      void host.writeCliTraceJson(traceSession, 'exit.json', {
        finishedAt: new Date().toISOString(),
        transport: 'acp-stdio',
      });
      await host.flushCliTrace(traceSession);
      host.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
    } catch (error) {
      logger.error('Grok Build ACP session error:', error);
      void host.writeCliTraceJson(traceSession, 'process-error.json', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Error',
        transport: 'acp-stdio',
      });
      await host.flushCliTrace(traceSession);

      if (session.cancelledByUs) {
        host.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
        return;
      }

      const sessionError = host.getSessionErrorPayload(error, session);
      host.broadcast('heteroAgentSessionError', {
        error: sessionError,
        sessionId: session.sessionId,
      });
      throw new Error(typeof sessionError === 'string' ? sessionError : sessionError.message, {
        cause: error,
      });
    } finally {
      await session.hostedProviderBinding?.cleanup();
      if (session.grokAcpSession === acpSession) session.grokAcpSession = undefined;
    }
    return;
  }

  const cwd = host.resolveSessionWorkingDirectory(session);
  const stderrChunks: string[] = [];
  const createCommonOptions = (traceSession: CliTraceSession | undefined) => ({
    args: session.args,
    clientVersion: electronApp.getVersion(),
    commandPath,
    cwd,
    env: spawnEnv,
    onEvents: async (events: unknown[]) => {
      for (const event of events) {
        host.broadcast('heteroAgentEvent', { event, sessionId: session.sessionId });
      }
    },
    onRawMessage: (line: string) => host.appendCliTraceFile(traceSession, 'stdout.jsonl', line),
    onRuntimeStatus: (status: unknown) => host.broadcast('heteroAgentRuntimeStatus', status),
    onSessionId: (agentSessionId: string) => {
      session.agentSessionId = agentSessionId;
    },
    onStderr: (data: string) => {
      stderrChunks.push(data);
      return host.appendCliTraceFile(traceSession, 'stderr.log', data);
    },
    operationId: params.operationId,
    resumeSessionId: session.agentSessionId,
    sessionId: session.sessionId,
  });

  if (session.agentType === 'cursor') {
    const prompt = buildCursorAcpPrompt(promptInput);
    const tracePayload = `${JSON.stringify(prompt)}\n`;
    const traceSession = await host.createCliTraceSession({
      cliArgs: buildCursorAcpArgs(session.args),
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload: tracePayload,
    });
    void host.writeCliTraceFile(traceSession, 'stdin.txt', tracePayload);
    if (session.cancelledByUs) {
      await host.completeCancelledSessionBeforeLaunch(session);
      return;
    }
    const intervention = host.setupAcpInterventionForOp(
      params.operationId,
      session.sessionId,
      'cursor',
    );
    const cursorAcpSession = new CursorAcpSession({
      ...createCommonOptions(traceSession),
      askUserBridge: intervention.bridge,
      prompt,
    });
    session.cursorAcpSession = cursorAcpSession;
    await runInteractiveAcpSession(host, {
      acpSession: cursorAcpSession,
      activeSessionKey: 'cursorAcpSession',
      cleanup: intervention.cleanup,
      isResumeError: isCursorAcpSessionNotFoundError,
      session,
      stderrChunks,
      traceSession,
      transport: 'cursor-acp',
    });
    return;
  }

  if (session.agentType === 'droid') {
    const prompt = await buildDroidAcpPrompt(promptInput, { cacheDir: host.fileCacheDir });
    const tracePayload = `${JSON.stringify(prompt)}\n`;
    const traceSession = await host.createCliTraceSession({
      cliArgs: buildDroidAcpArgs(session.args),
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload: tracePayload,
    });
    void host.writeCliTraceFile(traceSession, 'stdin.txt', tracePayload);
    if (session.cancelledByUs) {
      await host.completeCancelledSessionBeforeLaunch(session);
      return;
    }
    const intervention = host.setupAcpInterventionForOp(
      params.operationId,
      session.sessionId,
      'droid',
    );
    const droidAcpSession = new DroidAcpSession({
      ...createCommonOptions(traceSession),
      askUserBridge: intervention.bridge,
      initialModel: session.model,
      onModel: (model) => {
        session.model = model;
        session.modelSource = 'droid-acp';
      },
      prompt,
    });
    session.droidAcpSession = droidAcpSession;
    await runInteractiveAcpSession(host, {
      acpSession: droidAcpSession,
      activeSessionKey: 'droidAcpSession',
      cleanup: intervention.cleanup,
      isResumeError: isDroidAcpSessionNotFoundError,
      session,
      stderrChunks,
      traceSession,
      transport: 'droid-acp',
    });
    return;
  }

  if (session.agentType === 'devin') {
    const prompt = await buildDevinAcpPrompt(promptInput, { cacheDir: host.fileCacheDir });
    const tracePayload = `${JSON.stringify(prompt)}\n`;
    const traceSession = await host.createCliTraceSession({
      cliArgs: buildDevinAcpArgs(session.args),
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload: tracePayload,
    });
    void host.writeCliTraceFile(traceSession, 'stdin.txt', tracePayload);
    if (session.cancelledByUs) {
      await host.completeCancelledSessionBeforeLaunch(session);
      return;
    }
    const intervention = host.setupAcpInterventionForOp(
      params.operationId,
      session.sessionId,
      'devin',
    );
    const devinAcpSession = new DevinAcpSession({
      ...createCommonOptions(traceSession),
      askUserBridge: intervention.bridge,
      initialModel: session.model,
      onModel: (model) => {
        session.model = model;
        session.modelSource = 'devin-acp';
      },
      prompt,
    });
    session.devinAcpSession = devinAcpSession;
    await runInteractiveAcpSession(host, {
      acpSession: devinAcpSession,
      activeSessionKey: 'devinAcpSession',
      cleanup: intervention.cleanup,
      isResumeError: isDevinAcpSessionNotFoundError,
      session,
      stderrChunks,
      traceSession,
      transport: 'devin-acp',
    });
    return;
  }

  if (session.agentType === 'copilot') {
    const prompt = await buildCopilotAcpPrompt(promptInput, { cacheDir: host.fileCacheDir });
    const tracePayload = `${JSON.stringify(prompt)}\n`;
    const traceSession = await host.createCliTraceSession({
      cliArgs: buildCopilotAcpArgs(session.args),
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload: tracePayload,
    });
    void host.writeCliTraceFile(traceSession, 'stdin.txt', tracePayload);
    if (session.cancelledByUs) {
      await host.completeCancelledSessionBeforeLaunch(session);
      return;
    }
    const intervention = host.setupAcpInterventionForOp(
      params.operationId,
      session.sessionId,
      'copilot',
    );
    const copilotAcpSession = new CopilotAcpSession({
      ...createCommonOptions(traceSession),
      askUserBridge: intervention.bridge,
      initialModel: session.model,
      onModel: (model) => {
        session.model = model;
        session.modelSource = 'copilot-acp';
      },
      prompt,
    });
    session.copilotAcpSession = copilotAcpSession;
    await runInteractiveAcpSession(host, {
      acpSession: copilotAcpSession,
      activeSessionKey: 'copilotAcpSession',
      cleanup: intervention.cleanup,
      isResumeError: isCopilotAcpSessionNotFoundError,
      session,
      stderrChunks,
      traceSession,
      transport: 'copilot-acp',
    });
    return;
  }

  if (session.agentType === 'trae') {
    const prompt = await buildTraeAcpPrompt(promptInput, { cacheDir: host.fileCacheDir });
    const tracePayload = `${JSON.stringify(prompt)}\n`;
    const traceSession = await host.createCliTraceSession({
      cliArgs: buildTraeAcpArgs(session.args),
      cwd,
      imageList: params.imageList ?? [],
      session,
      stdinPayload: tracePayload,
    });
    void host.writeCliTraceFile(traceSession, 'stdin.txt', tracePayload);
    if (session.cancelledByUs) {
      await host.completeCancelledSessionBeforeLaunch(session);
      return;
    }
    const traeAcpSession = new TraeAcpSession({
      ...createCommonOptions(traceSession),
      initialModel: session.model,
      onModel: (model) => {
        session.model = model;
        session.modelSource = 'trae-acp';
      },
      prompt,
    });
    session.traeAcpSession = traeAcpSession;
    await runInteractiveAcpSession(host, {
      acpSession: traeAcpSession,
      activeSessionKey: 'traeAcpSession',
      cleanup: async () => {
        await session.hostedProviderBinding?.cleanup();
      },
      session,
      stderrChunks,
      traceSession,
      transport: 'trae-acp',
    });
  }
};
