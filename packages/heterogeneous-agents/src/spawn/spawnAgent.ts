import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline } from './agentStreamPipeline';
import { resolveCliSpawnPlan } from './cliSpawn';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { buildAgentInput } from './input';

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
   * (Claude Code only) Pass `--include-partial-messages` so the CLI streams
   * delta chunks instead of only complete blocks. Off by default — terminal
   * runs and bulk-ingest flows usually want fewer events. Turn on when a
   * connected client renders live token streaming.
   */
  includePartialMessages?: boolean;
  /**
   * Image normalization options (URL fetch + on-disk cache + path
   * materialization). Forwarded to `buildAgentInput`. When `prompt` is a
   * plain string this is unused.
   */
  inputOptions?: BuildAgentInputOptions;
  /**
   * Operation id stamped onto every emitted `AgentStreamEvent`. For ingest-
   * connected runs this is the server-allocated op id; for standalone runs
   * (no `--topic` / `--operation-id`) the CLI generates a fresh uuid so
   * events still carry the conventional shape.
   */
  operationId: string;
  /**
   * User prompt. A plain string is sugar for a single text block; the array
   * form supports mixed text + image content blocks (URL / path / base64).
   * Translated to per-agent stdin + CLI flags via `buildAgentInput`.
   */
  prompt: AgentPromptInput;
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
   * The agent's native session id, extracted from the `system:init` event.
   * Available after the `events` async iterable has been fully consumed.
   * Used by `lh hetero exec` to pass `sessionId` to `heteroFinish` so the
   * server can persist it for `--resume` on the next turn.
   */
  readonly sessionId: string | undefined;
  /**
   * The child's stderr stream — caller can pipe to its own stderr or
   * collect for error reporting. The pipeline does not consume stderr.
   */
  stderr: NodeJS.ReadableStream;
}

/**
 * Invariant Claude Code CLI flags shared by every spawn site (desktop driver,
 * `lh hetero exec`). Permission mode and `--include-partial-messages` vary by
 * caller — the desktop UI wants live deltas + user-mode bypassPermissions, the
 * sandbox CLI may run as root and skip partials — so they're composed on top
 * of this base.
 *
 * `AskUserQuestion` is disabled because CC's CLI self-injects an
 * `is_error: "Answer questions?"` tool_result in `-p` mode before the host
 * can surface the questions, so the model falls back to plain-text prompting
 * anyway. Remove this once a local MCP-backed replacement is wired to
 * LobeHub's intervention UI.
 */
export const CLAUDE_CODE_BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--disallowedTools',
  'AskUserQuestion',
] as const;

// bypassPermissions is blocked when running as root (e.g. cloud sandbox).
// Fall back to acceptEdits + pre-approved tools so the agent can still run
// headlessly without interactive permission prompts.
const isRunningAsRoot = () => process.getuid?.() === 0;

const CLAUDE_CODE_PERMISSION_ARGS = (): string[] =>
  isRunningAsRoot()
    ? [
        '--permission-mode',
        'acceptEdits',
        '--allowed-tools',
        'Bash,Read,Write,Edit,MultiEdit,WebSearch,mcp__*',
      ]
    : ['--permission-mode', 'bypassPermissions'];

const CODEX_REQUIRED_ARGS = ['--json', '--skip-git-repo-check', '--full-auto'] as const;

interface BuildSpawnArgsParams {
  agentType: string;
  /** Extra CLI arguments appended after the agent's preset flags. */
  extraArgs: string[];
  /** (Claude Code only) Stream `--include-partial-messages` deltas. */
  includePartialMessages: boolean;
  /** Per-agent input args produced by `buildAgentInput` (e.g. Codex `--image`). */
  inputArgs: string[];
  /** Native session id for resume; undefined for fresh runs. */
  resumeSessionId: string | undefined;
}

const buildClaudeCodeArgs = ({
  extraArgs,
  includePartialMessages,
  inputArgs,
  resumeSessionId,
}: BuildSpawnArgsParams) => [
  ...CLAUDE_CODE_BASE_ARGS,
  ...(includePartialMessages ? ['--include-partial-messages'] : []),
  ...CLAUDE_CODE_PERMISSION_ARGS(),
  ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ...inputArgs,
  ...extraArgs,
];

const buildCodexArgs = ({ extraArgs, inputArgs, resumeSessionId }: BuildSpawnArgsParams) =>
  resumeSessionId
    ? ['exec', 'resume', ...CODEX_REQUIRED_ARGS, ...inputArgs, ...extraArgs, resumeSessionId, '-']
    : ['exec', ...CODEX_REQUIRED_ARGS, ...inputArgs, ...extraArgs];

const buildSpawnArgs = (params: BuildSpawnArgsParams): string[] => {
  switch (params.agentType) {
    case 'claude-code': {
      return buildClaudeCodeArgs(params);
    }
    case 'codex': {
      return buildCodexArgs(params);
    }
    default: {
      throw new Error(`spawnAgent: unsupported agent type "${params.agentType}"`);
    }
  }
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
 * Stays minimal on purpose — no on-disk tracing, no proxy env composition,
 * no CLI-not-found classification. Those host concerns live in the desktop
 * main controller, which has its own spawn logic on top. The CLI sandbox is
 * a smaller environment where the minimal surface is correct.
 *
 * Returns a Promise because image normalization (URL fetch / file read) is
 * async; the spawn itself happens after the input plan is resolved so a
 * failed image fetch surfaces before the child starts.
 */
export const spawnAgent = async (options: SpawnAgentOptions): Promise<SpawnAgentHandle> => {
  const command = options.command || defaultCommand(options.agentType);
  const inputPlan = await buildAgentInput(options.agentType, options.prompt, options.inputOptions);
  const args = buildSpawnArgs({
    agentType: options.agentType,
    extraArgs: options.extraArgs ?? [],
    includePartialMessages: options.includePartialMessages ?? false,
    inputArgs: inputPlan.args,
    resumeSessionId: options.resumeSessionId,
  });
  const cwd = options.cwd || process.cwd();

  const cliSpawnPlan = await resolveCliSpawnPlan(command, args);
  const proc = spawn(cliSpawnPlan.command, cliSpawnPlan.args, {
    cwd,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }));
      proc.on('error', (err) => reject(err));
    },
  );

  if (proc.stdin) {
    proc.stdin.write(inputPlan.stdin, () => {
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

  return {
    events,
    exit,
    kill: (signal: NodeJS.Signals = 'SIGINT') => killProcessTree(proc, signal),
    pid: proc.pid,
    get sessionId() {
      return pipeline.sessionId;
    },
    stderr,
  };
};
