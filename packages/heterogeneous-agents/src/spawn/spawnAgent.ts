import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline } from './agentStreamPipeline';

export interface SpawnAgentOptions {
  /** Agent type key (`'claude-code'` | `'codex'`). */
  agentType: string;
  /**
   * Override the CLI binary name. Defaults to `'claude'` for `claude-code`,
   * `'codex'` for `codex`. Use this when the binary lives at a non-default
   * path or is wrapped by a launcher.
   */
  command?: string;
  /** Working directory for the spawned child. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Extra environment variables merged on top of `process.env`. */
  env?: Record<string, string>;
  /** Extra CLI arguments appended after the agent's preset flags. */
  extraArgs?: string[];
  /**
   * Operation id stamped onto every emitted `AgentStreamEvent`. For ingest-
   * connected runs this is the server-allocated op id; for standalone runs
   * (no `--topic` / `--operation-id`) the CLI generates a fresh uuid so
   * events still carry the conventional shape.
   */
  operationId: string;
  /** User prompt text. Always passed via stdin (CC: stream-json; Codex: raw). */
  prompt: string;
  /** Resume an existing agent session by its native session id (CC) / thread id (Codex). */
  resumeSessionId?: string;
}

export interface SpawnAgentHandle {
  /**
   * Async iterable of `AgentStreamEvent`s parsed + adapted from the child's
   * stdout. Yields events as they arrive; iteration ends after `stdout`
   * fully drains AND the adapter's `flush()` events have been delivered.
   */
  events: AsyncIterable<AgentStreamEvent>;
  /**
   * Resolves once the child process exits. Note: this resolves on the
   * underlying `'exit'` event, which Node may fire before stdio is fully
   * closed — `events` already gates on `stdout` end internally, so consumers
   * should iterate `events` to completion BEFORE awaiting `exit` if they
   * care about ordering.
   */
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /**
   * Send a signal to the child. On Unix, the child is spawned with
   * `detached: true` so the whole process group can be signaled via
   * `process.kill(-pid, signal)`; this helper does that automatically.
   */
  kill: (signal?: NodeJS.Signals) => void;
  /** Spawned child PID, undefined if spawn failed pre-PID. */
  pid: number | undefined;
  /**
   * The child's stderr stream — caller can pipe to its own stderr or
   * collect for error reporting. The pipeline does not consume stderr.
   */
  stderr: NodeJS.ReadableStream;
}

const CLAUDE_CODE_BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode',
  'bypassPermissions',
] as const;

const CODEX_REQUIRED_ARGS = ['--json', '--skip-git-repo-check', '--full-auto'] as const;

const buildClaudeCodeArgs = (resumeSessionId: string | undefined, extraArgs: string[]) => [
  ...CLAUDE_CODE_BASE_ARGS,
  ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ...extraArgs,
];

const buildCodexArgs = (resumeSessionId: string | undefined, extraArgs: string[]) =>
  resumeSessionId
    ? ['exec', 'resume', ...CODEX_REQUIRED_ARGS, ...extraArgs, resumeSessionId, '-']
    : ['exec', ...CODEX_REQUIRED_ARGS, ...extraArgs];

const buildSpawnArgs = (
  agentType: string,
  resumeSessionId: string | undefined,
  extraArgs: string[],
): string[] => {
  switch (agentType) {
    case 'claude-code': {
      return buildClaudeCodeArgs(resumeSessionId, extraArgs);
    }
    case 'codex': {
      return buildCodexArgs(resumeSessionId, extraArgs);
    }
    default: {
      throw new Error(`spawnAgent: unsupported agent type "${agentType}"`);
    }
  }
};

const buildStdinPayload = (agentType: string, prompt: string): string => {
  if (agentType === 'claude-code') {
    return `${JSON.stringify({
      message: { content: [{ text: prompt, type: 'text' }], role: 'user' },
      type: 'user',
    })}\n`;
  }
  // Codex reads the prompt as plain text from stdin (the `-` positional in
  // resume mode also reads from stdin).
  return prompt;
};

const defaultCommand = (agentType: string): string => (agentType === 'codex' ? 'codex' : 'claude');

const killProcessTree = (proc: ChildProcess, signal: NodeJS.Signals): void => {
  if (!proc.pid || proc.killed) return;

  // On Windows the spawn `detached` flag has different semantics; fall back
  // to a direct signal. Tree-kill via `taskkill` is what the desktop
  // controller does for end-user CC, but the CLI's primary use case is
  // sandbox + Unix dev terminals, so keep this minimal.
  if (process.platform === 'win32') {
    try {
      proc.kill(signal);
    } catch {
      // already gone
    }
    return;
  }

  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // already gone
    }
  }
};

/**
 * Spawn an external agent CLI (Claude Code or Codex) and yield its stream as
 * unified `AgentStreamEvent`s. Used by `lh hetero exec` for both standalone
 * terminal runs and (later) sandbox-driven runs that ingest into the server.
 *
 * Stays minimal on purpose — no image attachment, no on-disk tracing, no
 * proxy env composition, no CLI-not-found classification. Those host
 * concerns live in the desktop main controller, which does NOT use this
 * function (it instantiates `AgentStreamPipeline` directly with its own
 * spawn logic). The CLI sandbox is a smaller environment where the minimal
 * surface is correct.
 */
export const spawnAgent = (options: SpawnAgentOptions): SpawnAgentHandle => {
  const command = options.command || defaultCommand(options.agentType);
  const args = buildSpawnArgs(options.agentType, options.resumeSessionId, options.extraArgs ?? []);
  const stdinPayload = buildStdinPayload(options.agentType, options.prompt);
  const cwd = options.cwd || process.cwd();

  const proc = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (proc.stdin) {
    proc.stdin.write(stdinPayload, () => {
      proc.stdin?.end();
    });
  }

  const pipeline = new AgentStreamPipeline({
    agentType: options.agentType,
    operationId: options.operationId,
  });
  const stdout = proc.stdout!;
  const stderr = proc.stderr!;

  // Buffer of events ready to be consumed by the AsyncIterable below. The
  // generator and the stdout listeners coordinate through this single queue +
  // wakeup promise — keeps backpressure simple and avoids a third-party
  // dependency.
  const queue: AgentStreamEvent[] = [];
  let streamEnded = false;
  let streamError: Error | undefined;
  let wakeup: (() => void) | undefined;

  const wake = () => {
    if (wakeup) {
      const w = wakeup;
      wakeup = undefined;
      w();
    }
  };

  // ALL pipeline work — push / flush — runs through this single chain so:
  //   1. multiple `'data'` chunks process in arrival order, even when an
  //      earlier `pipeline.push()` is still awaiting the Codex tracker's FS
  //      reads (without the chain, push #2 can resolve before push #1 and
  //      events come out of order)
  //   2. `'end'`'s flush always runs AFTER every queued push has drained, so
  //      `streamEnded` is never flipped while earlier chunks still have events
  //      to deliver — otherwise the async iterator could return `done: true`
  //      before late events were queued (event loss).
  let pipelineQueue: Promise<void> = Promise.resolve();

  const enqueuePush = (chunk: Buffer) => {
    pipelineQueue = pipelineQueue.then(async () => {
      try {
        const events = await pipeline.push(chunk);
        for (const event of events) queue.push(event);
        wake();
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        streamEnded = true;
        wake();
      }
    });
  };

  const enqueueFlush = () => {
    pipelineQueue = pipelineQueue.then(async () => {
      try {
        const events = await pipeline.flush();
        for (const event of events) queue.push(event);
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
      } finally {
        streamEnded = true;
        wake();
      }
    });
  };

  stdout.on('data', enqueuePush);
  stdout.on('end', enqueueFlush);
  stdout.on('error', (err) => {
    // Append onto the same chain so the error is surfaced strictly after any
    // in-flight push finishes — late events still get a chance to land before
    // the iterator throws.
    pipelineQueue = pipelineQueue.then(() => {
      streamError = err;
      streamEnded = true;
      wake();
    });
  });

  const events: AsyncIterable<AgentStreamEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<AgentStreamEvent>> {
          while (true) {
            if (queue.length > 0) {
              return { done: false, value: queue.shift()! };
            }
            if (streamError) throw streamError;
            if (streamEnded) return { done: true, value: undefined };
            await new Promise<void>((res) => {
              wakeup = res;
            });
          }
        },
      };
    },
  };

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }));
      proc.on('error', (err) => reject(err));
    },
  );

  return {
    events,
    exit,
    kill: (signal: NodeJS.Signals = 'SIGINT') => killProcessTree(proc, signal),
    pid: proc.pid,
    stderr,
  };
};
