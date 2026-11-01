import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import { buildHeterogeneousPrompt } from '@lobechat/heterogeneous-agents/protocol';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import {
  buildAgentInput,
  buildCodexAppServerArgs,
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  CodexAppServerClient,
  CodexThreadSession,
  isCodexAppServerCompatibilityError,
  pickCodexRunProvenance,
  readCodexSessionModel,
  resolveCodexInitialModel,
} from '@lobechat/heterogeneous-agents/spawn';
import { truncateTitle } from '@lobechat/heterogeneous-agents/transcript';
import { app as electronApp } from 'electron';

import type { HeteroInflightRunRegistry } from '@/modules/heterogeneousAgent/inflightRunRegistry';
import { createLogger } from '@/utils/logger';

import type { AgentSession, CliTraceSession, SendPromptParams } from './heterogeneousAgentSession';

const logger = createLogger('controllers:HeterogeneousAgentCtr');

/** Controller-owned services used by the Codex transport without owning other transports. */
interface CodexAppServerHost {
  appendCliTraceFile: (
    trace: CliTraceSession | undefined,
    name: string,
    data: string,
  ) => Promise<void> | undefined;
  broadcast: <T>(channel: string, data: T) => void;
  buildSessionSpawnEnv: (session: AgentSession, bindProcessOwner: boolean) => NodeJS.ProcessEnv;
  /** Shared process slot; individual native threads retain their own ownership. */
  clientState: { client?: CodexAppServerClient };
  completeCancelledSessionBeforeLaunch: (session: AgentSession) => Promise<void>;
  createCliTraceSession: (args: {
    cliArgs: string[];
    cwd: string;
    imageList: NonNullable<SendPromptParams['imageList']>;
    session: AgentSession;
    stdinPayload: string;
  }) => Promise<CliTraceSession | undefined>;
  /** Attachment cache shared with the other desktop transports. */
  fileCacheDir: string;
  flushCliTrace: (trace: CliTraceSession | undefined) => Promise<void>;
  getErrorMessage: (error: unknown) => string | undefined;
  getInflightRuns: () => HeteroInflightRunRegistry | undefined;
  getSessionErrorPayload: (
    error: unknown,
    session: AgentSession,
  ) => HeterogeneousAgentSessionError | string;
  needsSessionIntroduction: (session: AgentSession) => boolean;
  recordInflightRun: (args: {
    cwd: string;
    params: SendPromptParams;
    session: AgentSession;
    startedAt: string;
  }) => void;
  resolveSessionCommand: (session: AgentSession) => string;
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

/**
 * Runs one desktop Codex turn through the shared app-server and its native thread.
 *
 * Use when:
 * - The controller dispatches a session using the Codex app-server transport.
 *
 * Expects:
 * - A controller-owned process slot and mutable session, with per-run identity in params.
 *
 * Returns:
 * - True after handling the turn; false only when the caller should fall back to exec.
 *
 * Call stack:
 *
 * HeterogeneousAgentCtr.sendPrompt
 *   -> {@link sendPromptWithCodexAppServer}
 *     -> {@link CodexThreadSession.run}
 */
export async function sendPromptWithCodexAppServer(
  host: CodexAppServerHost,
  params: SendPromptParams,
  session: AgentSession,
): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const cwd = session.cwd || electronApp.getPath('desktop');
  // One app-server serves multiple topics; ownership belongs to each thread, not its process.
  const spawnEnv = host.buildSessionSpawnEnv(session, false);
  const commandPath = session.resolvedCommandPath ?? host.resolveSessionCommand(session);
  const promptInput = buildHeterogeneousPrompt({
    imageList: params.imageList,
    isNewSession: host.needsSessionIntroduction(session),
    prompt: params.prompt,
    systemContext: params.systemContext,
  });
  let inputPlan;
  try {
    inputPlan = await buildAgentInput('codex', promptInput, { cacheDir: host.fileCacheDir });
  } catch (error) {
    logger.error('Failed to prepare Codex app-server input:', error);
    throw new Error(
      `Failed to attach image(s) to Codex app-server: ${host.getErrorMessage(error) || 'Unknown error'}`,
      { cause: error },
    );
  }

  const input = buildCodexAppServerInput(inputPlan);
  const appServerArgs = buildCodexAppServerArgs(session.args);
  const initialModel = await resolveCodexInitialModel({ args: session.args, env: spawnEnv });
  if (initialModel?.model) {
    session.model = initialModel.model;
    session.modelSource = initialModel.source;
  }
  const initialCumulativeUsage = session.agentSessionId
    ? (await readCodexSessionModel(session.agentSessionId, { env: spawnEnv }))?.cumulativeUsage
    : undefined;
  const inputPayload = `${JSON.stringify(input)}\n`;
  const traceSession = await host.createCliTraceSession({
    cliArgs: appServerArgs,
    cwd,
    imageList: params.imageList ?? [],
    session,
    stdinPayload: inputPayload,
  });
  void host.writeCliTraceFile(traceSession, 'stdin.txt', inputPayload);

  if (session.cancelledByUs) {
    await host.completeCancelledSessionBeforeLaunch(session);
    return true;
  }

  const clientOptions = {
    args: appServerArgs.slice(0, -1),
    clientVersion: electronApp.getVersion(),
    commandPath,
    cwd,
    env: spawnEnv,
  };
  const existingClient = host.clientState.client;
  if (existingClient && !existingClient.canReuseFor(clientOptions)) {
    if (!existingClient.hasConsumers) {
      existingClient.close();
      if (host.clientState.client === existingClient) host.clientState.client = undefined;
    } else {
      const message =
        'The running Codex app-server uses a different binary, global configuration, or environment';
      logger.error('Cannot reuse the native Codex app-server client:', {
        sessionId: session.sessionId,
      });
      void host.writeCliTraceJson(traceSession, 'process-error.json', {
        message,
        transport: 'codex-app-server',
      });
      await host.flushCliTrace(traceSession);
      host.broadcast('heteroAgentSessionError', {
        error: message,
        sessionId: session.sessionId,
      });
      throw new Error(message);
    }
  }

  const client =
    host.clientState.client ?? (host.clientState.client = new CodexAppServerClient(clientOptions));
  const appServerSession =
    session.appServerSession ??
    new CodexThreadSession({
      client,
      initialCumulativeUsage,
      initialModel: session.model,
      initialThreadId: session.agentSessionId,
      threadName: truncateTitle(params.prompt),
      onEvents: async (events) => {
        for (const event of events) {
          host.broadcast('heteroAgentEvent', {
            event,
            sessionId: session.sessionId,
          });
        }
      },
      onModel: (model) => {
        session.model = model;
        session.modelSource = 'codex-app-server';
      },
      onRuntimeStatus: (status) => {
        host.broadcast('heteroAgentRuntimeStatus', status);
      },
      onSessionId: (agentSessionId) => {
        if (agentSessionId === session.agentSessionId) return;
        session.agentSessionId = agentSessionId;
        host.getInflightRuns()?.patch(session.sessionId, { agentSessionId });
      },
      sessionId: session.sessionId,
      threadParams: buildCodexAppServerThreadParams(session.args, cwd, session.model),
    });
  session.appServerSession = appServerSession;
  // No pid: the app-server process is shared, so reaping this run stops its session instead.
  // A renderer reload then releases the native thread rather than leaving it claimed.
  host.recordInflightRun({ cwd, params, session, startedAt });

  logger.info('Starting Codex app-server session:', {
    commandPath,
    cwd,
    sessionId: session.sessionId,
  });

  try {
    await appServerSession.run({
      input,
      onRawMessage: (line) => host.appendCliTraceFile(traceSession, 'stdout.jsonl', line),
      operationId: params.operationId,
      provenance: pickCodexRunProvenance({
        ...spawnEnv,
        LOBEHUB_OPERATION_ID: params.operationId,
      }),
    });
    void host.writeCliTraceJson(traceSession, 'exit.json', {
      finishedAt: new Date().toISOString(),
      transport: 'codex-app-server',
    });
    await host.flushCliTrace(traceSession);
    host.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
    return true;
  } catch (error) {
    if (appServerSession.canFallbackToExec && isCodexAppServerCompatibilityError(error)) {
      session.codexAppServerFallback = true;
      logger.warn('Falling back to codex exec because native app-server is unavailable:', {
        message: host.getErrorMessage(error),
        sessionId: session.sessionId,
      });
      void host.writeCliTraceJson(traceSession, 'fallback.json', {
        message: host.getErrorMessage(error),
        transport: 'codex-app-server',
      });
      await host.flushCliTrace(traceSession);
      host.broadcast('heteroAgentEvent', {
        event: {
          data: {
            message:
              'Codex app-server is unavailable or incompatible. Upgrade Codex to use the Labs transport; continuing with codex exec.',
          },
          operationId: params.operationId,
          stepIndex: 0,
          timestamp: Date.now(),
          type: 'stream_retry',
        } satisfies AgentStreamEvent,
        sessionId: session.sessionId,
      });
      appServerSession.close();
      if (session.appServerSession === appServerSession) session.appServerSession = undefined;
      if (!client.hasConsumers) {
        client.close();
        if (host.clientState.client === client) host.clientState.client = undefined;
      }
      return false;
    }

    logger.error('Codex app-server session error:', error);
    appServerSession.close();
    if (session.appServerSession === appServerSession) session.appServerSession = undefined;
    void host.writeCliTraceJson(traceSession, 'process-error.json', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error',
      transport: 'codex-app-server',
    });
    await host.flushCliTrace(traceSession);

    if (session.cancelledByUs) {
      host.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
      return true;
    }

    const sessionError = host.getSessionErrorPayload(error, session);
    host.broadcast('heteroAgentSessionError', {
      error: sessionError,
      sessionId: session.sessionId,
    });
    throw new Error(typeof sessionError === 'string' ? sessionError : sessionError.message, {
      cause: error,
    });
  }
}
