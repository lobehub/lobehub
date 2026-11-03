import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { resolveHeterogeneousAgentCommand } from '../config';
import { isPathLikeCommand } from './cliSpawn';
import { buildCursorAcpPrompt, CursorAcpSession } from './cursorAcpSession';
import { buildDevinAcpPrompt, DevinAcpSession } from './devinAcpSession';
import { buildDroidAcpPrompt, DroidAcpSession } from './droidAcpSession';
import { buildGrokAcpPrompt, GrokAcpSession } from './grokAcpSession';
import type { SpawnAgentHandle, SpawnAgentOptions } from './spawnAgent';
import { buildTraeAcpPrompt, TraeAcpSession } from './traeAcpSession';
import { assertSpawnableWorkingDirectory } from './workingDirectory';

/**
 * ACP runtimes (Cursor, Devin, Droid, Grok, TRAE) behind the ordinary
 * `SpawnAgentHandle` contract returned by `spawnAgent`.
 */

/** Guarded raw-stdout tee: diagnostic sink failures must not affect the ACP run. */
const teeAcpRawStdout =
  (onRawStdout?: (chunk: Buffer) => void) =>
  (line: string): void => {
    if (!onRawStdout) return;
    try {
      onRawStdout(Buffer.from(line));
    } catch {
      // raw dump is diagnostic-only; never let it disrupt the run
    }
  };

/**
 * Bridge a bidirectional ACP session onto the ordinary `SpawnAgentHandle`
 * contract shared by the one-shot CLI spawns.
 *
 * Exit/error policy (uniform for every ACP agent):
 * - Host kills resolve `exit` as `{ code: null, signal }`.
 * - ACP request failures are first adapted into a terminal error event and
 *   then reject the session's run() promise. Once that structured event is
 *   queued, the iterable ends normally so callers can apply their error
 *   policy; transport failures with no terminal event still throw from the
 *   iterator.
 */
const createAcpSpawnBridge = () => {
  const stderr = new PassThrough();
  const queue: AgentStreamEvent[] = [];
  let emittedTerminalError = false;
  let hostSignal: NodeJS.Signals | null = null;
  let streamEnded = false;
  let streamError: Error | undefined;
  let wakeup: (() => void) | undefined;

  const wake = () => {
    const resolve = wakeup;
    wakeup = undefined;
    resolve?.();
  };
  const getHostExit = (): { code: null; signal: NodeJS.Signals } | undefined =>
    hostSignal ? { code: null, signal: hostSignal } : undefined;

  const onEvents = (events: AgentStreamEvent[]): void => {
    if (events.some(({ type }) => type === 'error')) emittedTerminalError = true;
    queue.push(...events);
    wake();
  };
  const onStderr = (data: string): void => {
    stderr.write(data);
  };

  const events: AsyncIterable<AgentStreamEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<AgentStreamEvent>> {
          while (true) {
            const event = queue.shift();
            if (event) return { done: false, value: event };
            if (streamError) throw streamError;
            if (streamEnded) return { done: true, value: undefined };
            await new Promise<void>((resolve) => {
              wakeup = resolve;
            });
          }
        },
      };
    },
  };

  const attach = (session: {
    close: (signal?: NodeJS.Signals | null) => void;
    interrupt: () => void;
    run: () => Promise<void>;
  }): Pick<SpawnAgentHandle, 'exit' | 'interrupt' | 'kill'> => {
    const exit: SpawnAgentHandle['exit'] = session
      .run()
      .then(() => getHostExit() ?? { code: 0, signal: null })
      .catch((error) => {
        const hostExit = getHostExit();
        if (hostExit) return hostExit;

        if (!emittedTerminalError) {
          streamError = error instanceof Error ? error : new Error(String(error));
        }
        return { code: 1, signal: null };
      })
      .finally(() => {
        streamEnded = true;
        stderr.end();
        wake();
      });

    const kill = (signal: NodeJS.Signals = 'SIGINT'): void => {
      hostSignal = signal;
      if (signal === 'SIGINT') session.interrupt();
      else session.close(signal);
    };
    const interrupt = (signal: NodeJS.Signals = 'SIGINT'): void => {
      hostSignal = signal;
      // SIGTERM already reached the child through the inherited process group.
      // Close pending RPCs without interrupting the child's shutdown again.
      if (signal === 'SIGTERM') session.close(null);
      else kill(signal);
    };
    return { exit, interrupt, kill };
  };

  return { attach, events, onEvents, onStderr, stderr };
};

interface AcpSpawnSession {
  close: (signal?: NodeJS.Signals | null) => void;
  interrupt: () => void;
  pid?: number;
  run: () => Promise<void>;
  sessionId?: string;
}

const createAcpSpawnHandle = (
  bridge: ReturnType<typeof createAcpSpawnBridge>,
  session: AcpSpawnSession,
  getSessionId: () => string | undefined = () => session.sessionId,
): SpawnAgentHandle => {
  const { exit, interrupt, kill } = bridge.attach(session);

  return {
    events: bridge.events,
    exit,
    interrupt,
    kill,
    get pid() {
      return session.pid;
    },
    get sessionId() {
      return getSessionId();
    },
    stderr: bridge.stderr,
  };
};

export const spawnGrokAcpAgent = async (
  options: SpawnAgentOptions,
  command: string,
  cwd: string,
): Promise<SpawnAgentHandle> => {
  const prompt = await buildGrokAcpPrompt(options.prompt, options.inputOptions);
  const bridge = createAcpSpawnBridge();
  const session = new GrokAcpSession({
    args: options.extraArgs ?? [],
    clientVersion: 'lobehub-cli',
    commandPath: command,
    cwd,
    detached: options.detached,
    env: { ...process.env, ...options.env },
    onEvents: bridge.onEvents,
    onRawMessage: teeAcpRawStdout(options.onRawStdout),
    onRuntimeStatus: () => {},
    onSessionId: () => {},
    onStderr: bridge.onStderr,
    operationId: options.operationId,
    prompt,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.operationId,
  });
  return createAcpSpawnHandle(bridge, session);
};

export const spawnCursorAcpAgent = async (
  options: SpawnAgentOptions,
  command: string,
  cwd: string,
): Promise<SpawnAgentHandle> => {
  const prompt = buildCursorAcpPrompt(options.prompt);
  const bridge = createAcpSpawnBridge();
  const session = new CursorAcpSession({
    args: options.extraArgs ?? [],
    askUserBridge: options.askUserBridge,
    clientVersion: 'lobehub-cli',
    commandPath: command,
    cwd,
    detached: options.detached,
    env: { ...process.env, ...options.env },
    onEvents: bridge.onEvents,
    onRawMessage: teeAcpRawStdout(options.onRawStdout),
    onRuntimeStatus: () => {},
    onSessionId: () => {},
    onStderr: bridge.onStderr,
    operationId: options.operationId,
    prompt,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.operationId,
  });
  return createAcpSpawnHandle(bridge, session);
};

export const spawnDroidAcpAgent = async (
  options: SpawnAgentOptions,
  command: string,
  cwd: string,
): Promise<SpawnAgentHandle> => {
  const prompt = await buildDroidAcpPrompt(options.prompt, options.inputOptions);
  const bridge = createAcpSpawnBridge();
  const session = new DroidAcpSession({
    args: options.extraArgs ?? [],
    askUserBridge: options.askUserBridge,
    clientVersion: 'lobehub-cli',
    commandPath: command,
    cwd,
    env: { ...process.env, ...options.env },
    initialModel: options.initialModel,
    onEvents: bridge.onEvents,
    onRawMessage: teeAcpRawStdout(options.onRawStdout),
    onRuntimeStatus: () => {},
    onSessionId: () => {},
    onStderr: bridge.onStderr,
    operationId: options.operationId,
    prompt,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.operationId,
  });
  const { exit, interrupt, kill } = bridge.attach(session);

  return {
    events: bridge.events,
    exit,
    interrupt,
    kill,
    get pid() {
      return session.pid;
    },
    get sessionId() {
      return session.nativeSessionId;
    },
    stderr: bridge.stderr,
  };
};

export const spawnDevinAcpAgent = async (
  options: SpawnAgentOptions,
  command: string,
  cwd: string,
): Promise<SpawnAgentHandle> => {
  const prompt = await buildDevinAcpPrompt(options.prompt, options.inputOptions);
  const bridge = createAcpSpawnBridge();
  const session = new DevinAcpSession({
    args: options.extraArgs ?? [],
    askUserBridge: options.askUserBridge,
    clientVersion: 'lobehub-cli',
    commandPath: command,
    cwd,
    detached: options.detached,
    env: { ...process.env, ...options.env },
    initialModel: options.initialModel,
    onEvents: bridge.onEvents,
    permissionMode: options.permissionMode,
    onRawMessage: teeAcpRawStdout(options.onRawStdout),
    onRuntimeStatus: () => {},
    onSessionId: () => {},
    onStderr: bridge.onStderr,
    operationId: options.operationId,
    prompt,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.operationId,
  });
  return createAcpSpawnHandle(bridge, session);
};

/** Spawn TRAE's bidirectional ACP runtime behind the ordinary SpawnAgentHandle contract. */
export const spawnTraeAcpAgent = async (options: SpawnAgentOptions): Promise<SpawnAgentHandle> => {
  const requestedCommand = resolveHeterogeneousAgentCommand('trae', options.command);
  const cwd = options.cwd || process.cwd();
  assertSpawnableWorkingDirectory(cwd);
  const command =
    isPathLikeCommand(requestedCommand) && !path.isAbsolute(requestedCommand)
      ? path.resolve(cwd, requestedCommand)
      : requestedCommand;
  const childEnv = { ...process.env, ...options.env };
  const { detectHeterogeneousCliCommand } = await import('./resolveCliCommand');
  const commandStatus = await detectHeterogeneousCliCommand('trae', command, childEnv);
  if (!commandStatus.available || !commandStatus.path) {
    throw new Error(`TRAE command does not expose the required ACP runtime: ${requestedCommand}`);
  }

  const prompt = await buildTraeAcpPrompt(options.prompt, options.inputOptions);
  const bridge = createAcpSpawnBridge();
  const session = new TraeAcpSession({
    args: options.extraArgs ?? [],
    clientVersion: '1.0.0',
    commandPath: commandStatus.path,
    cwd,
    detached: options.detached,
    env: {
      ...childEnv,
      ...(commandStatus.resolvedPathEnv ? { PATH: commandStatus.resolvedPathEnv } : {}),
    },
    initialModel: options.initialModel,
    onEvents: bridge.onEvents,
    onRawMessage: teeAcpRawStdout(options.onRawStdout),
    onRuntimeStatus: () => {},
    onSessionId: () => {},
    onStderr: bridge.onStderr,
    operationId: options.operationId,
    prompt,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.operationId,
  });
  return createAcpSpawnHandle(bridge, session, () => session.nativeSessionId);
};
