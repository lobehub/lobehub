import { PassThrough } from 'node:stream';

import type { CodexForkTarget } from '@lobechat/types';

import { type AgentPromptInput, buildHeterogeneousPrompt } from '../protocol';
import { createEventQueue } from '../spawn/agentEventQueue';
import { buildAgentInput } from '../spawn/input';
import type { SpawnAgentHandle } from '../spawn/spawnAgent';
import {
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  getCodexAppServerUnsupportedArgs,
} from './appServerParams';
import { CodexAppServerClient } from './CodexAppServerClient';
import { CodexThreadSession } from './CodexThreadSession';

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
  /** Immutable source turn boundary; absent when continuing an established child. */
  forkTarget?: CodexForkTarget;
  /** Raw native protocol trace callback. */
  onRawStdout?: (chunk: Buffer) => void;
  /** Registers cancellation before native startup begins. */
  onStartupControl?: (control: { cancel: (signal: NodeJS.Signals) => Promise<void> }) => void;
  /** Server operation receiving the normal event stream. */
  operationId: string;
  /** Current user input and attachments; native history is never reconstructed from text. */
  prompt: AgentPromptInput;
  /** Native session to resume. A missing session fails this attempt. */
  resumeSessionId?: string;
  /**
   * Fork branches: the caller must not restart or replay a missing native history.
   * Ordinary topics leave this unset so the caller can retry with its transcript fallback.
   */
  strictHistory?: boolean;
}

/**
 * Runs a native Codex turn through the CLI's normal ingest and cancellation loop.
 *
 * Use when:
 * - A connected device receives an explicitly native Codex operation.
 * Expects:
 * - Supported native arguments and, for Fork, a saved source session/turn boundary.
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
    resume: Boolean(options.resumeSessionId || options.forkTarget),
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
  const provenance = {
    LOBEHUB_AGENT_ID: options.env.LOBEHUB_AGENT_ID ?? '',
    LOBEHUB_OPERATION_ID: options.operationId,
    LOBEHUB_TOPIC_ID: options.env.LOBEHUB_TOPIC_ID ?? '',
  };
  const threadParams = buildCodexAppServerThreadParams(options.args, options.cwd);
  // Pin shell identity on native start/resume as well as the operation-owned process.
  // The same per-turn context is consumed by the shared app-server isolation contract.
  threadParams.config = {
    ...threadParams.config,
    'shell_environment_policy.set.LOBEHUB_AGENT_ID': provenance.LOBEHUB_AGENT_ID,
    'shell_environment_policy.set.LOBEHUB_OPERATION_ID': provenance.LOBEHUB_OPERATION_ID,
    'shell_environment_policy.set.LOBEHUB_TOPIC_ID': provenance.LOBEHUB_TOPIC_ID,
  };
  const session = new CodexThreadSession({
    client,
    forkTarget: options.forkTarget,
    initialThreadId: options.resumeSessionId,
    onEvents: (batch) => events.push(batch),
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
    // Gateway prompts are prepared as source resumes. Only native boundary resolution
    // knows whether before-first-turn Fork produced an empty session needing its guide.
    input: async (isNewSession: boolean) => {
      const sessionIntroduction =
        isNewSession && options.forkTarget
          ? buildCodexAppServerInput(
              await buildAgentInput(
                'codex',
                buildHeterogeneousPrompt({ isNewSession, prompt: '' }),
              ),
            )
          : [];
      // Keep the already materialized user input and attachment paths unchanged.
      return [...sessionIntroduction, ...buildCodexAppServerInput(input)];
    },
    onRawMessage: (line: string) => options.onRawStdout?.(Buffer.from(line)),
    operationId: options.operationId,
    provenance,
  };
  // A Stop queued during input materialization must not start a new native turn.
  const execution = cancelledSignal ? Promise.resolve() : session.run(turnOptions);
  const exit = execution
    .then(
      () => ({ code: cancelledSignal ? null : 0, signal: cancelledSignal ?? null }),
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        stderr.write(
          `${options.strictHistory && (options.resumeSessionId || options.forkTarget) ? 'Native Codex history is unavailable; refusing to restart or replay the branch. ' : ''}${detail}\n`,
        );
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
