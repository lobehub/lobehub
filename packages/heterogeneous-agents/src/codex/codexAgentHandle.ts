import { PassThrough } from 'node:stream';

import type { AgentPromptInput } from '../protocol';
import { createEventQueue } from '../spawn/agentEventQueue';
import { buildCodexLobeHubContextArgs, createCodexJwtFile } from '../spawn/codexShellEnv';
import { buildAgentInput } from '../spawn/input';
import type { SpawnAgentHandle } from '../spawn/spawnAgent';
import {
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  getCodexAppServerUnsupportedArgs,
} from './appServerParams';
import { CodexAppServerClient } from './CodexAppServerClient';
import { CodexThreadSession } from './CodexThreadSession';
import { pickCodexRunProvenance } from './environment';

/** Native Codex execution inputs for a single connected-device operation. */
export interface CodexAgentHandleOptions {
  /** Existing provider arguments; unsupported policies are rejected, never weakened. */
  args: string[];
  /** Caller version sent in the native initialize handshake. */
  clientVersion: string;
  /** Resolved, validated Codex executable path. */
  commandPath: string;
  /** Working directory already authorized by device dispatch. */
  cwd: string;
  /** Environment inherited by the native process. */
  env: NodeJS.ProcessEnv;
  /** Raw native protocol trace callback. */
  onRawStdout?: (chunk: Buffer) => void;
  /** Registers cancellation before native startup begins. */
  onStartupControl?: (control: { cancel: (signal: NodeJS.Signals) => Promise<void> }) => void;
  /** Server operation receiving the normal event stream. */
  operationId: string;
  /** Current user input and attachments; native history is never reconstructed from text. */
  prompt: AgentPromptInput;
  /**
   * Native session to resume. A missing session fails this attempt; the caller decides
   * whether to retry fresh with its transcript fallback.
   */
  resumeSessionId?: string;
}

/**
 * Runs a native Codex turn through the CLI's normal ingest and cancellation loop.
 *
 * Use when:
 * - A connected device receives an explicitly native Codex operation.
 * Expects:
 * - Supported native arguments and, when resuming, a saved native session.
 * Returns:
 * - A spawn-compatible handle preserving native session and turn provenance.
 *
 * Call stack:
 *
 * lh hetero exec
 *   -> {@link createCodexAgentHandle}
 *     -> {@link CodexThreadSession.run}
 *       -> {@link CodexAppServerClient.request}
 */
export const createCodexAgentHandle = async (
  options: CodexAgentHandleOptions,
): Promise<SpawnAgentHandle> => {
  const unsupported = getCodexAppServerUnsupportedArgs(options.args, {
    resume: Boolean(options.resumeSessionId),
  });
  if (unsupported.length > 0) {
    throw new Error(`Native Codex does not support these arguments: ${unsupported.join(', ')}`);
  }
  // Use the existing input materializer so local/remote attachments have the same semantics.
  const input = await buildAgentInput('codex', options.prompt);
  const events = createEventQueue();
  // stderr stays a stream because the CLI classifies startup failures from this channel.
  const stderr = new PassThrough();
  const client = new CodexAppServerClient({
    // CodexAppServerClient owns the app-server subcommand. Thread options belong in RPC params.
    args: undefined,
    clientVersion: options.clientVersion,
    commandPath: options.commandPath,
    cwd: options.cwd,
    env: options.env,
  });
  const stopStderr = client.onStderr((chunk) => {
    stderr.write(chunk);
  });
  let nativeSessionId: string | undefined;
  let cancelledSignal: NodeJS.Signals | undefined;
  // The session ends a turn lost to a transport crash with an interrupted runtime end and
  // resolves; without a Stop from this operation that is a truncated run, not a success.
  let nativeTurnInterrupted = false;
  const provenance = pickCodexRunProvenance({
    ...options.env,
    LOBEHUB_OPERATION_ID: options.operationId,
  });
  // Codex shells get their env from `[shell_environment_policy]`, so a user's
  // `inherit = "core"` would drop the run context `lh` needs. Forward it as
  // `set` overrides; the JWT travels as a 0600 file path, never in the config.
  const jwtFile = options.env.LOBEHUB_JWT
    ? await createCodexJwtFile(options.env.LOBEHUB_JWT)
    : undefined;
  const threadParams = buildCodexAppServerThreadParams(
    [...buildCodexLobeHubContextArgs(options.env), ...(jwtFile?.args ?? []), ...options.args],
    options.cwd,
  );
  // Pin shell identity on native start/resume as well as the operation-owned process.
  // The same per-turn context is consumed by the shared app-server isolation contract.
  threadParams.config = {
    ...threadParams.config,
    ...Object.fromEntries(
      Object.entries(provenance).map(([key, value]) => [
        `shell_environment_policy.set.${key}`,
        value ?? '',
      ]),
    ),
  };
  const session = new CodexThreadSession({
    client,
    initialThreadId: options.resumeSessionId,
    onEvents: (batch) => {
      if (
        batch.some(
          (event) =>
            event.type === 'agent_runtime_end' &&
            (event.data as { reason?: unknown } | undefined)?.reason === 'interrupted',
        )
      ) {
        nativeTurnInterrupted = true;
      }
      events.push(batch);
    },
    onRuntimeStatus: () => {},
    onSessionId: (id) => {
      nativeSessionId = id;
    },
    sessionId: options.operationId,
    threadParams,
  });
  const cancel = async (signal: NodeJS.Signals) => {
    cancelledSignal = signal;
    if (signal === 'SIGINT') await session.interrupt();
    else {
      session.close();
      client.close();
    }
  };
  options.onStartupControl?.({ cancel });
  const turnOptions = {
    // Keep the already materialized user input and attachment paths unchanged.
    input: buildCodexAppServerInput(input),
    onRawMessage: (line: string) => options.onRawStdout?.(Buffer.from(line)),
    operationId: options.operationId,
    provenance,
  };
  // A Stop queued during input materialization must not start a new native turn.
  const execution = cancelledSignal ? Promise.resolve() : session.run(turnOptions);
  const exit = execution
    .then(
      () => {
        if (cancelledSignal) return { code: null, signal: cancelledSignal };
        if (!nativeTurnInterrupted) return { code: 0, signal: null };
        stderr.write('Codex app-server interrupted the turn before it completed\n');
        return { code: 1, signal: null };
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        stderr.write(`${detail}\n`);
        return { code: cancelledSignal ? null : 1, signal: cancelledSignal ?? null };
      },
    )
    .finally(() => {
      // Each CLI operation owns its app-server process; closing it leaves the native history on disk.
      session.close();
      client.close();
      stopStderr();
      events.close();
      stderr.end();
      void jwtFile?.cleanup();
    });
  return {
    events,
    exit,
    kill: (signal = 'SIGINT') => {
      void cancel(signal).catch(() => {
        session.close();
        client.close();
      });
    },
    pid: undefined,
    get sessionId() {
      return nativeSessionId;
    },
    stderr,
  };
};
