import type { ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { spawnManaged } from '@lobechat/utils/managedProcess';

import { ClaudeCodeAdapter } from '../adapters/claudeCode';
import type { AskUserBridge } from '../askUser/AskUserBridge';
import { resolveHeterogeneousAgentCommand } from '../config';
import {
  spawnCursorAcpAgent,
  spawnDevinAcpAgent,
  spawnDroidAcpAgent,
  spawnGrokAcpAgent,
  spawnTraeAcpAgent,
} from './acpSpawnAgent';
import { AgentStreamPipeline, type UploadHeterogeneousImage } from './agentStreamPipeline';
import { buildAntigravityArgs } from './antigravity';
import { ClaudeCodeLiveInput } from './claudeCodeLiveInput';
import { readClaudeCodeSessionCost } from './claudeCodeSessionCost';
import { resolveCliSpawnPlan } from './cliSpawn';
import { readCodexSessionModel, resolveCodexInitialModel } from './codexModel';
import {
  buildCodexLobeHubContextArgs,
  type CodexJwtFile,
  createCodexJwtFile,
} from './codexShellEnv';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { buildAgentInput } from './input';
import { prepareClaudeCodeLobeHubCli } from './lobeHubCliPlugin';
import { getHeterogeneousAgentPresetEnv } from './presetEnv';
import { assertSpawnableWorkingDirectory } from './workingDirectory';

export interface SpawnAgentOptions {
  /** Registered local heterogeneous-agent type key. */
  agentType: string;
  /** Bridge for bidirectional question requests emitted by ACP agents. */
  askUserBridge?: AskUserBridge;
  /**
   * Override the CLI binary name. Defaults to the agent's standard executable.
   * Use this when the binary lives at a non-default
   * path or is wrapped by a launcher.
   */
  command?: string;
  /**
   * Version of the CLI being spawned, when the caller detected it. Claude Code
   * gets the `lh` guide as a skill only on a version known to load one.
   */
  commandVersion?: string;
  /** Working directory for the spawned child. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Create a dedicated Unix process group. Disable beneath a detached wrapper. */
  detached?: boolean;
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
  /** Initial model selected through the agent protocol after session setup (Droid/TRAE ACP). */
  initialModel?: string;
  /**
   * Image normalization options (URL fetch + on-disk cache + path
   * materialization). Forwarded to `buildAgentInput`. When `prompt` is a
   * plain string this is unused.
   */
  inputOptions?: BuildAgentInputOptions;
  /**
   * (Claude Code only) Keep stdin open while the session can still use input,
   * exposing `sendUserMessage` / `interruptTurn` on the handle. Runtime end is
   * then reported once at process exit instead of at every `result`.
   */
  liveInput?: boolean;
  /**
   * Optional tee for the child's RAW stdout bytes, invoked synchronously for
   * every chunk BEFORE the adapter sees it. The pipeline still consumes stdout
   * normally — this is a pure side-channel. `lh hetero exec --raw-dump` wires
   * it to a file writer so the untouched stream-json can be inspected after the
   * fact (e.g. to tell a CC-side empty `tool_result` apart from an adapter
   * extraction bug, which the adapted/ingested view alone can't distinguish).
   */
  onRawStdout?: (chunk: Buffer) => void;
  /**
   * Operation id stamped onto every emitted `AgentStreamEvent`. For ingest-
   * connected runs this is the server-allocated op id; for standalone runs
   * (no `--topic` / `--operation-id`) the CLI generates a fresh uuid so
   * events still carry the conventional shape.
   */
  operationId: string;
  /** (Devin ACP only) Global `--permission-mode` value, placed before `acp`. */
  permissionMode?: string;
  /**
   * User prompt. A plain string is sugar for a single text block; the array
   * form supports mixed text + image content blocks (URL / path / base64).
   * Translated to per-agent stdin + CLI flags via `buildAgentInput`.
   */
  prompt: AgentPromptInput;
  /** Resume an existing agent session by its native session id (CC) / thread id (Codex). */
  resumeSessionId?: string;
  /**
   * Runtime uploader for tool_result images (CC `Read` on an image file). The
   * adapter emits the raw base64 on `pluginState.images`; the pipeline calls
   * this to swap each entry for an uploaded `{ fileId, url }` reference before
   * the event is persisted, so heavy base64 never reaches the ingest sinks.
   * Omit in standalone/offline runs — the pipeline then drops the image and
   * leaves the `[Image: …]` text placeholder as the fallback.
   */
  uploadImage?: UploadHeterogeneousImage;
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
   * Notify a session transport of host-initiated cancellation at the protocol
   * level (ACP `session/cancel`, RPC abort). Present only on session
   * transports — absent on one-shot CLI spawns where `kill` is the only
   * cancel channel. ACP SIGTERM closes the session without resending the
   * already-delivered signal; SIGINT retains protocol cancellation and its
   * grace timeout. SIGKILL remains a host-requested force-kill escalation.
   */
  interrupt?: (signal?: NodeJS.Signals) => void;
  /**
   * (Claude Code `liveInput` only) Stop the current turn without ending the
   * process, so background tasks keep running. False once input has closed.
   */
  interruptTurn?: () => boolean;
  /**
   * Send a signal to the child. A dedicated Unix process group is signaled as
   * a tree; inherited-group children receive a direct signal because their
   * outer wrapper owns group-level cancellation.
   */
  kill: (signal?: NodeJS.Signals) => void;
  /** Spawned child PID, undefined if spawn failed pre-PID. */
  pid: number | undefined;
  /**
   * (Claude Code `liveInput` only) Deliver a user message into the running
   * session; Claude Code reads it at its next tool boundary, or starts a turn
   * for it when idle. Resolves false once input has closed — the caller then
   * runs the message as a new turn instead.
   */
  sendUserMessage?: (prompt: AgentPromptInput, options?: { uuid?: string }) => Promise<boolean>;
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
 * anyway. `Monitor` and `ScheduleWakeup` are also disabled here because they
 * can hit the same stuck wakeup path in both desktop and sandbox runs.
 */
const CLAUDE_CODE_DISALLOWED_TOOLS = ['AskUserQuestion', 'Monitor', 'ScheduleWakeup'] as const;

export const CLAUDE_CODE_BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--disallowedTools',
  CLAUDE_CODE_DISALLOWED_TOOLS.join(','),
] as const;

/**
 * Headless CodeBuddy stream-json flags shared by desktop and `lh hetero exec`.
 * Interactive questions and background monitoring cannot be serviced reliably
 * by a one-shot print-mode process, so disable both tools.
 */
const CODEBUDDY_DISALLOWED_TOOLS = ['AskUserQuestion', 'Monitor'] as const;

export const CODEBUDDY_BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--disallowedTools',
  CODEBUDDY_DISALLOWED_TOOLS.join(','),
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

export const CODEX_REQUIRED_ARGS = ['--json', '--skip-git-repo-check'] as const;
export const CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG = '--dangerously-bypass-approvals-and-sandbox';
export const CODEX_DEFAULT_EXECUTION_ARGS = [CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG] as const;
export const CODEX_EXECUTION_MODE_FLAGS = [
  '--full-auto',
  CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG,
  '--sandbox',
  '-s',
] as const;

/**
 * Headless, private AMP execution flags shared by desktop and `lh hetero exec`.
 * AMP's stream-json protocol reports terminal failures as JSON even when the
 * process exits with code 0, so the dedicated adapter owns result validation.
 */
export const AMP_BASE_ARGS = [
  '--execute',
  '--stream-json-thinking',
  '--stream-json-input',
  '--visibility',
  'private',
  '--no-ide',
  '--no-notifications',
  '--no-archive-after-execute',
] as const;

export const OPENCODE_BASE_ARGS = ['run', '--format', 'json', '--thinking', '--auto'] as const;
export const KIMI_CODE_BASE_ARGS = ['--output-format', 'stream-json'] as const;
export const QODER_BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--include-partial-messages',
  '--permission-mode',
  'bypass_permissions',
] as const;

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

interface BuildSpawnArgsParams {
  agentType: string;
  /** (Codex only) `-c` overrides placed before `extraArgs` so callers can still override them. */
  configArgs?: string[];
  /** Extra CLI arguments appended after the agent's preset flags. */
  extraArgs: string[];
  /** (Claude Code only) Stream `--include-partial-messages` deltas. */
  includePartialMessages: boolean;
  /** Per-agent input args produced by `buildAgentInput` (e.g. Codex `--image`). */
  inputArgs: string[];
  /** (Claude Code only) Replay consumed user messages for live input. */
  liveInput?: boolean;
  /** Native session id for resume; undefined for fresh runs. */
  resumeSessionId: string | undefined;
}

const buildClaudeCodeArgs = ({
  extraArgs,
  includePartialMessages,
  inputArgs,
  liveInput,
  resumeSessionId,
}: BuildSpawnArgsParams) => [
  ...CLAUDE_CODE_BASE_ARGS,
  ...(includePartialMessages ? ['--include-partial-messages'] : []),
  ...(liveInput ? ['--replay-user-messages'] : []),
  ...CLAUDE_CODE_PERMISSION_ARGS(),
  ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ...inputArgs,
  ...extraArgs,
];

const buildCodeBuddyArgs = ({
  extraArgs,
  includePartialMessages,
  inputArgs,
  resumeSessionId,
}: BuildSpawnArgsParams) => [
  ...CODEBUDDY_BASE_ARGS,
  ...(includePartialMessages ? ['--include-partial-messages'] : []),
  '--permission-mode',
  'bypassPermissions',
  ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ...inputArgs,
  ...extraArgs,
];

const buildCodexArgs = ({
  configArgs = [],
  extraArgs,
  inputArgs,
  resumeSessionId,
}: BuildSpawnArgsParams) => {
  const executionModeArgs = hasAnyFlag(extraArgs, CODEX_EXECUTION_MODE_FLAGS)
    ? []
    : [...CODEX_DEFAULT_EXECUTION_ARGS];
  const optionArgs = [
    ...CODEX_REQUIRED_ARGS,
    ...executionModeArgs,
    ...inputArgs,
    ...configArgs,
    ...extraArgs,
  ];

  return resumeSessionId
    ? ['exec', 'resume', ...optionArgs, resumeSessionId, '-']
    : ['exec', ...optionArgs];
};

const buildAmpArgs = ({ extraArgs, inputArgs, resumeSessionId }: BuildSpawnArgsParams) => {
  const executionArgs = [...AMP_BASE_ARGS, ...inputArgs, ...extraArgs];

  return resumeSessionId
    ? ['threads', 'continue', resumeSessionId, ...executionArgs]
    : executionArgs;
};

const buildOpenCodeArgs = ({ extraArgs, inputArgs, resumeSessionId }: BuildSpawnArgsParams) => [
  ...OPENCODE_BASE_ARGS,
  ...(resumeSessionId ? ['--session', resumeSessionId] : []),
  ...inputArgs,
  ...extraArgs,
];

const buildPiArgs = (_params: BuildSpawnArgsParams): never => {
  // pi runs exclusively over the RPC transport (PiRpcSession /
  // createPiRpcAgentHandle). Reaching the legacy json spawn is a bug.
  throw new Error(
    'pi runs over the RPC transport only — use PiRpcSession / createPiRpcAgentHandle',
  );
};

const buildKimiCodeArgs = ({ extraArgs, inputArgs, resumeSessionId }: BuildSpawnArgsParams) => [
  ...KIMI_CODE_BASE_ARGS,
  ...(resumeSessionId ? ['--session', resumeSessionId] : []),
  ...extraArgs,
  ...inputArgs,
];

export interface QoderSpawnArgsOptions {
  extraArgs?: string[];
  inputArgs?: string[];
  resumeSessionId?: string;
}

export const buildQoderArgs = ({
  extraArgs = [],
  inputArgs = [],
  resumeSessionId,
}: QoderSpawnArgsOptions): string[] => [
  ...QODER_BASE_ARGS,
  ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ...extraArgs,
  ...inputArgs,
];

const buildSpawnArgs = (params: BuildSpawnArgsParams): string[] => {
  switch (params.agentType) {
    case 'antigravity': {
      return buildAntigravityArgs(params);
    }
    case 'amp': {
      return buildAmpArgs(params);
    }
    case 'claude-code': {
      return buildClaudeCodeArgs(params);
    }
    case 'codebuddy': {
      return buildCodeBuddyArgs(params);
    }
    case 'codex': {
      return buildCodexArgs(params);
    }
    case 'kimi-code': {
      return buildKimiCodeArgs(params);
    }
    case 'opencode': {
      return buildOpenCodeArgs(params);
    }
    case 'pi': {
      return buildPiArgs(params);
    }
    case 'qoder': {
      return buildQoderArgs(params);
    }
    default: {
      throw new Error(`spawnAgent: unsupported agent type "${params.agentType}"`);
    }
  }
};

const killProcessTree = (proc: ChildProcess, signal: NodeJS.Signals, detached: boolean): void => {
  if (!proc.pid || proc.killed) return;

  // On Windows the spawn `detached` flag has different semantics; fall back
  // to a direct signal. Tree-kill via `taskkill` is what the desktop
  // controller does for end-user CC, but the CLI's primary use case is
  // sandbox + Unix dev terminals, so keep this minimal.
  if (platform() === 'win32') {
    try {
      proc.kill(signal);
    } catch {
      // already gone
    }
    return;
  }

  if (detached) {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      // Fall through to a direct signal when the process group is gone.
    }
  }

  try {
    proc.kill(signal);
  } catch {
    // already gone
  }
};

/**
 * Spawn an external agent CLI (Amp, Claude Code, CodeBuddy, Codex, Cursor,
 * Factory Droid, Kimi Code, OpenCode, Pi, Qoder, or TRAE) and yield its stream as unified
 * `AgentStreamEvent`s. Used by `lh hetero exec` for both standalone
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
  if (options.agentType === 'trae') return spawnTraeAcpAgent(options);

  const command = resolveHeterogeneousAgentCommand(options.agentType, options.command);
  const cwd = options.cwd || process.cwd();
  assertSpawnableWorkingDirectory(cwd);
  if (options.agentType === 'devin') {
    return spawnDevinAcpAgent(options, command, cwd);
  }
  if (options.agentType === 'grok-build') {
    return spawnGrokAcpAgent(options, command, cwd);
  }
  if (options.agentType === 'cursor') {
    return spawnCursorAcpAgent(options, command, cwd);
  }
  if (options.agentType === 'droid') {
    return spawnDroidAcpAgent(options, command, cwd);
  }

  // A run answering a LobeHub conversation (`lh hetero exec --topic`) gets the
  // `lh` guide as a Claude Code skill rather than in the user's turn. The
  // caller's env, not the inherited one: a standalone run nested inside some
  // other conversation is not answering it.
  const lobeHubCli =
    options.agentType === 'claude-code' && options.env?.LOBEHUB_TOPIC_ID
      ? await prepareClaudeCodeLobeHubCli(options.prompt, options.extraArgs, {
          resumed: Boolean(options.resumeSessionId),
          version: options.commandVersion,
        })
      : { args: [], prompt: options.prompt };
  const promptPlan = await buildAgentInput(
    options.agentType,
    lobeHubCli.prompt,
    options.inputOptions,
  );
  const inputPlan = { ...promptPlan, args: [...lobeHubCli.args, ...promptPlan.args] };
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...getHeterogeneousAgentPresetEnv(options.agentType),
    ...options.env,
  };
  // Codex builds each shell command's env from `[shell_environment_policy]`,
  // not from its own process env, so a user's `inherit = "core"` strips the
  // run context `lh` needs. Forward it as `shell_environment_policy.set.*`
  // overrides; the JWT travels as a 0600 file path, never in argv.
  const codexJwtFile: CodexJwtFile | undefined =
    options.agentType === 'codex' && childEnv.LOBEHUB_JWT
      ? await createCodexJwtFile(childEnv.LOBEHUB_JWT)
      : undefined;
  try {
    return await spawnCliAgent(options, command, cwd, inputPlan, childEnv, codexJwtFile);
  } catch (error) {
    await codexJwtFile?.cleanup();
    throw error;
  }
};

/** One-shot JSONL CLI spawn; `spawnAgent` owns the Codex JWT file around it. */
const spawnCliAgent = async (
  options: SpawnAgentOptions,
  command: string,
  cwd: string,
  inputPlan: Awaited<ReturnType<typeof buildAgentInput>>,
  childEnv: NodeJS.ProcessEnv,
  codexJwtFile: CodexJwtFile | undefined,
): Promise<SpawnAgentHandle> => {
  const liveInput = options.agentType === 'claude-code' && options.liveInput === true;
  const args = buildSpawnArgs({
    agentType: options.agentType,
    configArgs:
      options.agentType === 'codex'
        ? [...buildCodexLobeHubContextArgs(childEnv), ...(codexJwtFile?.args ?? [])]
        : undefined,
    extraArgs: options.extraArgs ?? [],
    includePartialMessages: options.includePartialMessages ?? false,
    inputArgs: inputPlan.args,
    liveInput,
    resumeSessionId: options.resumeSessionId,
  });
  const initialModel =
    options.agentType === 'codex'
      ? (await resolveCodexInitialModel({ args, env: childEnv }))?.model
      : undefined;
  const resumedCodexSession =
    options.agentType === 'codex' && options.resumeSessionId
      ? await readCodexSessionModel(options.resumeSessionId, { env: childEnv })
      : undefined;
  const initialCumulativeUsage = resumedCodexSession?.cumulativeUsage;
  const initialSessionCostUsd =
    options.agentType === 'claude-code' && options.resumeSessionId
      ? await readClaudeCodeSessionCost({
          configDir: childEnv.CLAUDE_CONFIG_DIR,
          cwd,
          // Resolve from the child's environment: an overridden HOME moves the
          // transcript the CLI resumes from.
          home: childEnv.HOME,
          sessionId: options.resumeSessionId,
        })
      : undefined;

  const cliSpawnPlan = await resolveCliSpawnPlan(command, args);
  const detached = platform() !== 'win32' && (options.detached ?? true);
  const startedAt = Date.now();
  const proc = spawnManaged(cliSpawnPlan.command, cliSpawnPlan.args, {
    cwd,
    detached,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pipeline = new AgentStreamPipeline({
    // A live session can run more turns after its first `result`, so the
    // runtime ends once, at process exit, and the turn a background task's
    // completion opens is grouped under the tool that started it.
    adapter: liveInput
      ? new ClaudeCodeAdapter({
          runtimeEndStrategy: 'on-transport-close',
          signalBackgroundTaskCompletion: true,
        })
      : undefined,
    agentType: options.agentType,
    cwd,
    env: childEnv,
    initialCumulativeUsage,
    initialModel,
    initialSessionCostUsd,
    operationId: options.operationId,
    startedAt,
    uploadImage: options.uploadImage,
  });
  const stdout = proc.stdout!;
  const stderr = proc.stderr!;

  // Buffer of events ready to be consumed by the AsyncIterable below. The
  // generator and the stdout listeners coordinate through this single queue +
  // wakeup promise — keeps backpressure simple and avoids a third-party
  // dependency.
  const queue: AgentStreamEvent[] = [];
  let killedByUs = false;
  let sawErrorEvent = false;
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

  const failStream = (err: Error) => {
    streamError = err;
    streamEnded = true;
    wake();
  };

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }));
      proc.on('error', (err) => {
        failStream(err);
        reject(err);
      });
    },
  );
  if (codexJwtFile) {
    const removeJwtFile = () => codexJwtFile.cleanup();
    void exit.then(removeJwtFile, removeJwtFile);
  }

  const live = liveInput && proc.stdin ? new ClaudeCodeLiveInput(proc.stdin) : undefined;
  if (live) {
    live.send(inputPlan.stdin);
  } else if (proc.stdin) {
    proc.stdin.write(inputPlan.stdin, () => {
      proc.stdin?.end();
    });
  }

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
        sawErrorEvent ||= events.some((event) => event.type === 'error');
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
        live?.finish();
        const { code, signal } = await exit;
        if (code === 0 && !killedByUs) events.push(...pipeline.validateCompletion());
        sawErrorEvent ||= events.some((event) => event.type === 'error');
        for (const event of events) queue.push(event);
        // Only a clean exit after a finished turn ends the run here: a crash
        // after a result is a failure, not a completion. Print mode exits 1
        // when its last turn was an error result, which an interrupt is.
        const lastTurn = live?.lastTurn;
        const cleanExit =
          code === 0 || (lastTurn?.aborted === true && code === 1 && signal === null);
        if (lastTurn && cleanExit && !killedByUs && !sawErrorEvent) {
          const end = lastTurn.aborted
            ? { kind: 'aborted', reason: 'interrupted', terminalReason: lastTurn.terminalReason }
            : { reason: 'complete' };
          for (const event of pipeline.completeRuntime({ ...end, transport: 'cli-live' }))
            queue.push(event);
        }
        // Kimi Code reports usage only via its on-disk session wire log, so
        // it can only be collected now that the process has exited. The hook
        // is a no-op for every other agent type.
        for (const event of await pipeline.collectPostRunUsage({ env: childEnv })) {
          queue.push(event);
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
      } finally {
        streamEnded = true;
        wake();
      }
    });
  };

  stdout.on('data', (chunk: Buffer) => {
    // Tee the raw bytes first so the dump captures exactly what CC emitted,
    // independent of how the adapter later parses it. Best-effort: a throwing
    // sink must not break the stream, so guard it.
    if (options.onRawStdout) {
      try {
        options.onRawStdout(chunk);
      } catch {
        // raw dump is diagnostic-only; never let it disrupt the run
      }
    }
    live?.observe(chunk);
    enqueuePush(chunk);
  });
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
    ...(live && {
      interruptTurn: () => live.interrupt(),
      sendUserMessage: async (prompt: AgentPromptInput, sendOptions?: { uuid?: string }) => {
        if (!live.isOpen) return false;
        const plan = await buildAgentInput('claude-code', prompt, options.inputOptions);
        return live.send(plan.stdin, sendOptions?.uuid);
      },
    }),
    kill: (signal: NodeJS.Signals = 'SIGINT') => {
      killedByUs = true;
      live?.close();
      killProcessTree(proc, signal, detached);
    },
    pid: proc.pid,
    get sessionId() {
      return pipeline.sessionId;
    },
    stderr,
  };
};

export { spawnTraeAcpAgent } from './acpSpawnAgent';
