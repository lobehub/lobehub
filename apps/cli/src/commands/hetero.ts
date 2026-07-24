import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AskUserBridge } from '@lobechat/heterogeneous-agents/askUser';
import { LobeBuiltinMcpServer } from '@lobechat/heterogeneous-agents/builtinMcp';
import { resolveHeteroSpawnCommand } from '@lobechat/heterogeneous-agents/resolveCliCommand';
import type {
  AgentContentBlock,
  AgentImageSource,
  AgentPromptInput,
  AgentStreamEvent,
  UploadHeterogeneousImage,
} from '@lobechat/heterogeneous-agents/spawn';
import {
  classifyHeteroProcessFailure,
  createFileStoreImageUploader,
  isHeteroStatusGuideErrorData,
  spawnAgent,
} from '@lobechat/heterogeneous-agents/spawn';
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { CoalescingBatchIngester } from '../utils/CoalescingBatchIngester';
import { log } from '../utils/logger';
import { TrpcIngestSink } from '../utils/TrpcIngestSink';

const SUPPORTED_AGENT_TYPES = new Set(['amp', 'claude-code', 'codex', 'opencode']);
const CODEX_REASONING_EFFORT_CONFIG_KEY = 'model_reasoning_effort';
const CODEX_SERVICE_TIER_CONFIG_KEY = 'service_tier';

/**
 * Patterns that indicate a `--resume <sessionId>` run should be retried
 * without `--resume`.  Two classes of failure:
 *
 *   1. Session file missing (sandbox recycled): the container is ephemeral
 *      (~1 h idle TTL), so a new sandbox has an empty `~/.claude/projects/`
 *      and the stored session id is stale.
 *
 *   2. Context overflow (long conversation): the resumed session carries all
 *      accumulated history; when the combined token count exceeds the model's
 *      context window the API rejects the request immediately after CC
 *      initialises.  Starting fresh (no `--resume`) drops the old history and
 *      lets CC respond to the new prompt alone.
 *
 * Checked against:
 *   - `error` stream events emitted by the CC adapter from CC's result event
 *   - Accumulated stderr output (fallback when CC exits without a result event)
 */
const RESUME_RETRY_PATTERNS = [
  // Session file missing — sandbox was recycled
  /no conversation found/i,
  /session.*not found/i,
  /conversation.*not found/i,
  /resume.*not found/i,
  // Context overflow — API rejected the resumed session's accumulated history
  /prompt.*too long/i,
  /context.*too long/i,
  /context window.*exceed/i,
  /maximum.*context.*length/i,
] as const;

const looksLikeNeedsRetryWithoutResume = (text: string): boolean =>
  RESUME_RETRY_PATTERNS.some((p) => p.test(text));

interface ExecOptions {
  agentArg?: string[];
  command?: string;
  cwd?: string;
  effort?: string;
  image?: string[];
  inputJson?: string;
  model?: string;
  operationId?: string;
  prompt?: string;
  /**
   * When set, persist the agent process's RAW stdout/stderr (pre-adapter
   * stream-json) under `<rawDump>/<timestamp>-<operationId>/` for debugging.
   * Independent of `--render` and the server ingest path.
   */
  rawDump?: string;
  /**
   * Output rendering mode.
   *   jsonl — emit each `AgentStreamEvent` as a JSONL line on stdout (default
   *            when no --topic is set, or when explicitly requested).
   *   none  — suppress JSONL stdout; only server-ingest mode is active.
   *           Default when --topic is set and running non-interactively.
   */
  render?: 'jsonl' | 'none';
  resume?: string;
  /**
   * Speed mode selection (Codex only). Translated into the native
   * `service_tier` config; `fast` requests the Fast (priority) tier.
   */
  speed?: string;
  /**
   * Server topic id.  When set, enables server-ingest mode: events are
   * batch-POSTed to `aiAgent.heteroIngest` in addition to (or instead of)
   * being written to stdout.  Requires `--operation-id` to be a valid
   * server-allocated operation id.
   */
  topic?: string;
  type: string;
}

const collectImage = (value: string, previous: string[] = []): string[] => [...previous, value];
const collectAgentArg = (value: string, previous: string[] = []): string[] => [...previous, value];

const buildExtraArgs = (
  options: Pick<ExecOptions, 'agentArg' | 'effort' | 'model' | 'speed' | 'type'>,
): string[] | undefined => {
  const selectorArgs =
    options.type === 'amp'
      ? []
      : options.type === 'codex'
        ? [
            ...(options.model ? ['--model', options.model] : []),
            ...(options.effort
              ? ['-c', `${CODEX_REASONING_EFFORT_CONFIG_KEY}="${options.effort}"`]
              : []),
            ...(options.speed ? ['-c', `${CODEX_SERVICE_TIER_CONFIG_KEY}="${options.speed}"`] : []),
          ]
        : options.type === 'claude-code'
          ? [
              ...(options.model ? ['--model', options.model] : []),
              ...(options.effort ? ['--effort', options.effort] : []),
            ]
          : [...(options.model ? ['--model', options.model] : [])];
  const extraArgs = [...(options.agentArg ?? []), ...selectorArgs];

  return extraArgs.length > 0 ? extraArgs : undefined;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Resolve a raw `--input-json` argument: `'-'` (or empty) reads stdin, anything
 * else is treated as a filesystem path.
 */
const readInputJson = async (location: string): Promise<string> => {
  if (location === '-' || location === '') return readStdin();
  return readFile(location, 'utf8');
};

const looksLikeJsonInput = (value: string): boolean => {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

/**
 * Convert an `--image <value>` argument into an image source. Recognized
 * shapes: `https?://...` URL, `data:` URL, otherwise a filesystem path
 * resolved relative to the CLI's cwd.
 */
const parseImageArg = (value: string): AgentImageSource => {
  if (/^https?:\/\//i.test(value)) return { type: 'url', url: value };
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      throw new Error(`Invalid data URL for --image: ${value.slice(0, 40)}…`);
    }
    return { data: match[2]!, mediaType: match[1]!, type: 'base64' };
  }
  return { path: path.resolve(process.cwd(), value), type: 'path' };
};

/**
 * Best-effort coercion of a JSON-decoded value into an `AgentPromptInput`.
 * Accepts:
 *   - `'plain text'` → single text block
 *   - `[{ type: 'text', text }, { type: 'image', source }]` → content blocks
 *   - `{ content: [...] }` (Anthropic message shape) → unwraps `content`
 *   - `{ type: 'text', ... } | { type: 'image', ... }` → single block
 */
const coerceJsonPrompt = (parsed: unknown): AgentPromptInput => {
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed as AgentContentBlock[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.content)) return obj.content as AgentContentBlock[];
    if (obj.type === 'text' || obj.type === 'image') return [obj as AgentContentBlock];
  }
  throw new Error(
    'Invalid --input-json shape: expected a string, array of content blocks, ' +
      'or `{ content: [...] }` envelope.',
  );
};

interface ResolvedPrompt {
  /** Human-readable description for the empty-input check. */
  describe: () => string;
  prompt: AgentPromptInput;
}

const buildPromptFromText = (text: string, images: string[]): ResolvedPrompt => {
  if (images.length === 0) {
    return { describe: () => text.trim(), prompt: text };
  }
  const blocks: AgentContentBlock[] = [];
  if (text.length > 0) blocks.push({ text, type: 'text' });
  for (const image of images) {
    blocks.push({ source: parseImageArg(image), type: 'image' });
  }
  return {
    describe: () =>
      blocks
        .map((b) => (b.type === 'text' ? b.text.trim() : '[image]'))
        .filter(Boolean)
        .join(' ')
        .trim(),
    prompt: blocks,
  };
};

/**
 * Decide which input mode the user requested and produce a unified prompt.
 *
 * Mode resolution (mutually exclusive):
 *   1. `--input-json` → read JSON file or stdin, parse to content blocks
 *   2. `--prompt` (with optional `--image` flags) → text + images
 *   3. (default) read stdin: auto-detect JSON vs plain text by first char
 */
const resolvePrompt = async (options: ExecOptions): Promise<ResolvedPrompt> => {
  const images = options.image ?? [];

  if (options.inputJson !== undefined) {
    if (options.prompt !== undefined) {
      throw new Error('--prompt and --input-json are mutually exclusive.');
    }
    if (images.length > 0) {
      throw new Error('--image cannot be combined with --input-json (put images in the JSON).');
    }
    const raw = await readInputJson(options.inputJson);
    return { describe: () => raw.trim(), prompt: coerceJsonPrompt(JSON.parse(raw)) };
  }

  if (options.prompt !== undefined && options.prompt !== '-') {
    return buildPromptFromText(options.prompt, images);
  }

  // No --prompt or --prompt -: read stdin and auto-detect.
  const raw = await readStdin();
  if (looksLikeJsonInput(raw)) {
    return { describe: () => raw.trim(), prompt: coerceJsonPrompt(JSON.parse(raw)) };
  }
  return buildPromptFromText(raw, images);
};

interface RawStreamDumpAttempt {
  /** Flush + close both file streams. Resolves once the bytes are on disk. */
  close: () => Promise<void>;
  writeStderr: (chunk: Buffer) => void;
  writeStdout: (chunk: Buffer) => void;
}

/**
 * Persists the agent process's RAW stdout/stderr — the untouched stream-json,
 * BEFORE the adapter — to disk for post-hoc debugging. The adapted/ingested
 * view can't tell a CC-side empty `tool_result` apart from an adapter
 * extraction bug; the raw dump can.
 *
 * Enabled via `lh hetero exec --raw-dump <dir>`. Each exec gets its own
 * `<dir>/<timestamp>-<operationId>/` session folder; each spawn attempt (the
 * resume retry is a second attempt) writes `<label>.stdout.jsonl` /
 * `<label>.stderr.log`. Fully best-effort: any dump failure is logged and
 * swallowed so it never affects the run or its exit code.
 *
 * Future: the server-side sandbox runner (`spawnHeteroSandbox`) and the
 * desktop device path (`spawnLhHeteroExec`) can pass `--raw-dump` pointing at
 * a collectable location to capture remote runs the same way.
 */
class RawStreamDump {
  private constructor(private readonly dir: string) {}

  static async create(
    root: string,
    operationId: string,
    meta: Record<string, unknown>,
  ): Promise<RawStreamDump | undefined> {
    try {
      const safeTs = new Date().toISOString().replaceAll(/[.:]/g, '-');
      const dir = path.join(path.resolve(root), `${safeTs}-${operationId}`);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'meta.json'),
        `${JSON.stringify({ ...meta, operationId, startedAt: new Date().toISOString() }, null, 2)}\n`,
      );
      log.info(`Raw stream dump enabled → ${dir}`);
      return new RawStreamDump(dir);
    } catch (err) {
      log.warn(
        `Failed to initialize raw stream dump: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  openAttempt(label: string): RawStreamDumpAttempt {
    const stdout = createWriteStream(path.join(this.dir, `${label}.stdout.jsonl`));
    const stderr = createWriteStream(path.join(this.dir, `${label}.stderr.log`));
    // A failed dump write must never crash the run — drop write errors.
    stdout.on('error', () => {});
    stderr.on('error', () => {});
    return {
      close: () =>
        Promise.all([
          new Promise<void>((resolve) => stdout.end(() => resolve())),
          new Promise<void>((resolve) => stderr.end(() => resolve())),
        ]).then(() => undefined),
      writeStderr: (chunk: Buffer) => {
        stderr.write(chunk);
      },
      writeStdout: (chunk: Buffer) => {
        stdout.write(chunk);
      },
    };
  }
}

const exec = async (options: ExecOptions): Promise<void> => {
  if (!SUPPORTED_AGENT_TYPES.has(options.type)) {
    log.error(
      `Unsupported --type "${options.type}". Supported: ${[...SUPPORTED_AGENT_TYPES].join(', ')}`,
    );
    process.exit(2);
  }

  let resolved: ResolvedPrompt;
  try {
    resolved = await resolvePrompt(options);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  if (!resolved.describe()) {
    log.error(
      'Empty prompt. Pass --prompt <text>, --image <path>, --input-json <file|->, or pipe content via stdin.',
    );
    process.exit(2);
  }

  // Server-ingest mode is active when --topic is provided.
  // --operation-id must be a server-allocated id in this mode (the server
  // generates it before spawning the process and passes it via CLI args).
  const serverIngest = !!options.topic;
  if (serverIngest && !options.operationId) {
    log.error('--operation-id is required when --topic is set (server-ingest mode).');
    process.exit(2);
  }

  const operationId = options.operationId || randomUUID();

  // Optional raw stream dump (pre-adapter stdout/stderr) for debugging.
  let rawDump: RawStreamDump | undefined;
  if (options.rawDump) {
    rawDump = await RawStreamDump.create(options.rawDump, operationId, {
      agentType: options.type,
      cwd: options.cwd || process.cwd(),
      resume: options.resume ?? null,
      topicId: options.topic ?? null,
    });
  }

  // Determine JSONL output mode.
  // Explicit --render flag always wins. Otherwise: emit JSONL in standalone
  // mode; suppress in server-ingest mode (sink handles the data path).
  const emitJsonl = options.render === 'jsonl' || (options.render === undefined && !serverIngest);

  // Build the ingest sink — no-op for standalone mode, real tRPC sink for
  // server-ingest mode.  The tRPC client reads LOBEHUB_JWT (operation-scoped
  // JWT injected by the server) for authentication.
  const agentType = options.type as 'amp' | 'claude-code' | 'codex' | 'opencode';
  let sink: TrpcIngestSink | undefined;
  let serverIngester: CoalescingBatchIngester | undefined;
  // Uploader for tool_result images (CC `Read` on an image file). Reuses the
  // CLI's authenticated lambda client so the persisted event carries a
  // `{ fileId, url }` reference instead of heavy base64. Only wired in
  // server-ingest mode — standalone runs don't persist events, so there is
  // nothing to echo. The pipeline degrades a throw/undefined to the
  // `[Image: …]` text placeholder, so this never fails the run.
  let uploadImage: UploadHeterogeneousImage | undefined;
  if (serverIngest) {
    const client = await getTrpcClient();
    sink = new TrpcIngestSink(
      client,
      agentType,
      operationId,
      options.topic!,
      process.env.LOBEHUB_ASSISTANT_MESSAGE_ID,
    );
    serverIngester = new CoalescingBatchIngester(sink);

    uploadImage = createFileStoreImageUploader(async () => {
      const lambda = await getTrpcClient();
      return {
        checkFileHash: (input) => lambda.file.checkFileHash.mutate(input),
        createFile: (input) => lambda.file.createFile.mutate(input),
        createS3PreSignedUrl: (input) => lambda.upload.createS3PreSignedUrl.mutate(input),
      };
    });
  }

  // ─── AskUserQuestion MCP — remote Human-in-the-loop (claude-code only) ──────
  //
  // Mount the same `lobe_cc` MCP server the desktop app uses, but resolve the
  // bridge over the server's Redis stream instead of Electron IPC:
  //   - request out: `bridge.events()` ride the normal ingest sink → server
  //     `heteroIngest` → Redis stream → renderer shows the AskUserQuestion card.
  //   - response back: the sandbox can't read Redis, so a long-poll pulls the
  //     `agent_intervention_response` off the stream (published by the browser's
  //     `submitHeteroIntervention`) and resolves the pending bridge call.
  // The bridge's own 5-min timeout is the backstop, so a dropped poll or an
  // absent user never strands CC.
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let askServer: LobeBuiltinMcpServer | undefined;
  let askBridge: AskUserBridge | undefined;
  let askMcpConfigPath: string | undefined;
  const askPollAbort = new AbortController();
  if (serverIngest && agentType === 'claude-code' && serverIngester) {
    askServer = new LobeBuiltinMcpServer();
    await askServer.start();
    askBridge = askServer.registerOperation(operationId);
    askMcpConfigPath = path.join(os.tmpdir(), `lobe-cc-mcp-${operationId}.json`);
    await writeFile(
      askMcpConfigPath,
      JSON.stringify({
        mcpServers: {
          lobe_cc: {
            alwaysLoad: true,
            type: 'http',
            url: askServer.urlForOperation(operationId),
          },
        },
      }),
      'utf8',
    );

    // (i) Forward bridge events into the same ordered ingest path as CC's. The
    // request always goes out. For responses, only forward the ones the browser
    // can't have published itself — producer-side timeout / session_ended — so
    // the renderer's card un-sticks; browser-originated answers (success /
    // user_cancelled) are already on the stream via `submitHeteroIntervention`.
    void (async () => {
      for await (const event of askBridge!.events()) {
        if (event.type === 'agent_intervention_response') {
          const reason = (event.data as { cancelReason?: string })?.cancelReason;
          if (reason !== 'timeout' && reason !== 'session_ended') continue;
        }
        serverIngester!.push(event as AgentStreamEvent);
      }
    })();

    // (ii) Long-poll the server for the user's answer — only while a question is
    // actually pending, so an idle run holds no server invocation.
    void (async () => {
      const client = await getTrpcClient();
      let lastEventId = '$';
      while (!askPollAbort.signal.aborted) {
        if (askBridge!.pendingCount === 0) {
          await sleep(200);
          continue;
        }
        try {
          const res = await client.aiAgent.waitInterventionResponse.query({
            lastEventId,
            operationId,
          });
          lastEventId = res.lastEventId;
          for (const event of res.events) {
            const data = event.data as {
              cancelReason?: 'session_ended' | 'timeout' | 'user_cancelled';
              cancelled?: boolean;
              result?: unknown;
              toolCallId: string;
            };
            // Idempotent: resolve() no-ops on an unknown / already-settled id.
            askBridge!.resolve(data.toolCallId, {
              cancelReason: data.cancelReason,
              cancelled: data.cancelled,
              result: data.result,
            });
          }
        } catch {
          // Transient (server hiccup / token refresh) — back off and retry.
          // The bridge's 5-min timeout still bounds the overall wait.
          await sleep(1000);
        }
      }
    })();
  }

  /**
   * Build the `finish` error payload. Process-level failures the agent CLI
   * never got to report in-stream (spawn ENOENT because the CLI isn't
   * installed, an auth failure printed straight to stderr) are classified into
   * the structured status-guide shape and attached as `body`, so the client
   * renders the dedicated install/sign-in guide instead of the generic error
   * card. Unclassifiable failures keep the flat `{ message, type }` everything
   * downstream already handles.
   *
   * A classified error is always typed `AgentRuntimeError` — matching how the
   * adapters' in-stream classified errors (overloaded / rate_limit) persist —
   * instead of leaking the transport-internal `type` the failure happened to
   * surface through (`stream_error` for a spawn ENOENT reads wrong on a
   * "CLI not installed" error).
   */
  const buildFinishError = (
    message: string,
    type: string,
    errnoCode?: string,
  ): { body?: Record<string, unknown>; message: string; type: string } => {
    const classified = classifyHeteroProcessFailure({ agentType, detail: message, errnoCode });
    if (!classified) return { message, type };
    return { body: { ...classified }, message: classified.message, type: 'AgentRuntimeError' };
  };

  /**
   * Spawn one agent process and stream all its events into the server ingester.
   *
   * When `interceptResumeErrors` is true, any `error`-type event whose
   * message matches `RESUME_RETRY_PATTERNS` is withheld from the
   * ingester and signals a retry instead.  This keeps the server's
   * operation state clean: no terminal error event is pushed, so the
   * retry's events land on the same operationId without confusing the
   * renderer.
   *
   * Returns:
   *   code / signal — child exit info
   *   cancelled      — true when this CLI received SIGINT/SIGTERM for the run
   *   sessionId     — CC session id from `system.init` (undefined on resume failure)
   *   ingestError   — true when a batch could not be flushed after retries
   *   resumeNotFound — true when a resume-not-found error was intercepted
   *   sawTerminalError — true when a terminal `error` event was pushed to the
   *                      ingester (CC can relay an API/rate-limit error this way
   *                      and still exit 0, so the exit code alone is not enough)
   *   terminalErrorMessage — the message from that terminal `error` event, used
   *                      as the task-level error detail in the finish payload
   *   terminalErrorData — the full structured payload of that terminal `error`
   *                      event when the adapter already classified it into a
   *                      status-guide error (overloaded / rate_limit / …); the
   *                      finish leg forwards it verbatim as the error `body` so
   *                      the client renders the dedicated guide instead of the
   *                      generic error card
   *   stderrContent  — accumulated stderr (only when interceptResumeErrors=true)
   */
  const runOneAgent = async (
    spawnOpts: Parameters<typeof spawnAgent>[0],
    interceptResumeErrors: boolean,
    runLabel: string,
  ): Promise<{
    cancelled: boolean;
    code: number | null;
    ingestError: boolean;
    resumeNotFound: boolean;
    sawTerminalError: boolean;
    sessionId: string | undefined;
    signal: NodeJS.Signals | null;
    stderrContent: string;
    terminalErrorData: Record<string, unknown> | undefined;
    terminalErrorMessage: string | undefined;
  }> => {
    // One raw-dump file pair per spawn attempt (the resume retry is a second
    // attempt). The stdout tee runs inside `spawnAgent` before the adapter.
    const dumpAttempt = rawDump?.openAttempt(runLabel);

    // `spawnAgent` is async and can reject DURING image normalization — fetch
    // failures, missing local --image paths, decode errors.
    let handle: Awaited<ReturnType<typeof spawnAgent>>;
    try {
      handle = await spawnAgent({ ...spawnOpts, onRawStdout: dumpAttempt?.writeStdout });
    } catch (err) {
      await dumpAttempt?.close();
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to start agent:', message);
      if (serverIngester && sink) {
        try {
          await serverIngester.drain();
          await sink.finish({
            error: buildFinishError(message, 'AgentRuntimeError'),
            result: 'error',
          });
        } catch {
          // best-effort; process is exiting anyway
        }
      }
      process.exit(1);
    }

    // Always collect stderr — used for resume-error detection AND for
    // surfacing a meaningful error message to the server when CC fails
    // without emitting a structured error event.  Cap at 8 KB so the
    // collector doesn't grow unboundedly on a chatty run.
    // Always pipe to process.stderr too so users see auth prompts / warnings.
    const STDERR_CAP = 8 * 1024;
    let stderrContent = '';
    const stderrEnded = once(handle.stderr, 'end').then(() => undefined);
    handle.stderr.on('data', (chunk: Buffer) => {
      if (stderrContent.length < STDERR_CAP) {
        stderrContent += chunk.toString();
      }
      dumpAttempt?.writeStderr(chunk);
    });
    handle.stderr.pipe(process.stderr);
    const exit = handle.exit.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (stderrContent.length < STDERR_CAP) {
        stderrContent += `${stderrContent ? '\n' : ''}${message}`;
      }
      return { code: 1, signal: null as NodeJS.Signals | null };
    });

    // Ctrl-C → SIGINT to the child's process group.
    // Repeated Ctrl-C escalates to SIGKILL.
    let interrupted = false;
    const onSigint = () => {
      if (interrupted) {
        handle.kill('SIGKILL');
        return;
      }
      interrupted = true;
      handle.kill('SIGINT');
    };
    const onSigterm = () => {
      interrupted = true;
      handle.kill('SIGTERM');
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    // Stream events. Each event is optionally written as JSONL and pushed
    // into the ingester.  When intercepting resume errors, a matching
    // `error` event is withheld from the ingester and flags a retry instead.
    let resumeNotFound = false;
    let sawTerminalError = false;
    let terminalErrorMessage: string | undefined;
    let terminalErrorData: Record<string, unknown> | undefined;
    const ingestError = false;
    try {
      for await (const event of handle.events) {
        if (interceptResumeErrors && event.type === 'error') {
          const data = event.data as Record<string, unknown> | undefined;
          const msg = String(data?.message ?? data?.error ?? '');
          if (looksLikeNeedsRetryWithoutResume(msg)) {
            resumeNotFound = true;
            // Emit to JSONL for observability but do NOT push to ingester —
            // we are about to retry; the server must not see a terminal error.
            if (emitJsonl) process.stdout.write(`${JSON.stringify(event)}\n`);
            continue;
          }
        }
        // A terminal `error` event (e.g. an API/rate-limit error relayed by CC)
        // must mark the run as failed even when the child exits 0 — track it so
        // the finish result is not derived from the exit code alone. Capture the
        // message too, so the finish payload can surface it as the task-level
        // error detail (CC relays these on stdout, not stderr).
        if (event.type === 'error') {
          sawTerminalError = true;
          const data = event.data as Record<string, unknown> | undefined;
          terminalErrorMessage = String(data?.message ?? data?.error ?? '') || undefined;
          // Keep the adapter's already-classified status-guide payload
          // (overloaded / rate_limit carry `agentType` + `code`) so the finish
          // leg doesn't flatten it back to a bare string — the process-failure
          // classifier there only knows cli_not_found / auth_required.
          terminalErrorData = isHeteroStatusGuideErrorData(data) ? data : undefined;
        }
        if (emitJsonl) process.stdout.write(`${JSON.stringify(event)}\n`);
        serverIngester?.push(event);
      }
    } catch (err) {
      log.error(
        'Stream error from agent process:',
        err instanceof Error ? err.message : String(err),
      );
      if (serverIngester && sink) {
        try {
          await serverIngester.drain();
          // A spawn failure (missing CLI binary / cwd) surfaces HERE, not via
          // `exit`: `spawnAgent` fails the event stream on the child's `error`
          // event, so this catch runs and exits before the finish block below.
          // Pass the raw errno code along for precise classification.
          await sink.finish({
            error: buildFinishError(
              String(err),
              'stream_error',
              (err as NodeJS.ErrnoException | null)?.code,
            ),
            result: 'error',
          });
        } catch {
          // best-effort
        }
      }
      await dumpAttempt?.close();
      process.exit(1);
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }

    const { code, signal } = await exit;
    await stderrEnded;
    await dumpAttempt?.close();

    // Fallback stderr detection: CC may exit non-zero without emitting a
    // result event (e.g. it writes to stderr and quits immediately).
    if (
      interceptResumeErrors &&
      !resumeNotFound &&
      code !== 0 &&
      looksLikeNeedsRetryWithoutResume(stderrContent)
    ) {
      resumeNotFound = true;
    }

    return {
      cancelled: interrupted,
      code,
      ingestError,
      resumeNotFound,
      sawTerminalError,
      sessionId: handle.sessionId,
      signal,
      stderrContent,
      terminalErrorData,
      terminalErrorMessage,
    };
  };

  // ─── First run (with --resume if provided) ───────────────────────────────

  const interceptResume = !!options.resume;
  const extraArgs = [
    ...(buildExtraArgs(options) ?? []),
    // Point CC at the lobe_cc AskUserQuestion MCP server we just mounted.
    ...(askMcpConfigPath ? ['--mcp-config', askMcpConfigPath] : []),
  ];
  // Resolve the CLI binary once, up front, and reuse it for both the initial
  // run and the resume-retry. For the default bare command (`amp`/`codex`/`claude`)
  // this finds the validated binary — including an app-bundled Codex CLI when
  // a broken `codex` shim shadows PATH — so sandbox/terminal runs no longer
  // ENOENT on a stale global install. Custom commands are used verbatim.
  const resolvedCommand = await resolveHeteroSpawnCommand(agentType, options.command);
  const commandEnv = resolvedCommand.pathEnv ? { PATH: resolvedCommand.pathEnv } : undefined;

  const first = await runOneAgent(
    {
      agentType: options.type,
      command: resolvedCommand.command,
      cwd: options.cwd || process.cwd(),
      env: commandEnv,
      extraArgs,
      operationId,
      prompt: resolved.prompt,
      resumeSessionId: options.resume,
      uploadImage,
    },
    interceptResume,
    'attempt-1',
  );

  // ─── Auto-retry without --resume when the session cannot be used ─────────
  //
  // Two classes of failure detected via `RESUME_RETRY_PATTERNS`:
  //   A. Sandbox recycled: container is ephemeral (~1 h idle TTL); new sandbox
  //      has no CC session files so `--resume <staleId>` is rejected with a
  //      "no conversation found" error.
  //   B. Context overflow: the resumed session carries accumulated history that
  //      pushes the combined token count past the model limit; the API rejects
  //      the call with a "prompt is too long" error.
  //
  // In both cases we transparently restart CC without `--resume` so it starts a
  // fresh session.  The server's `heteroSessionId` is updated with the new id,
  // breaking the stale-session loop.
  let result = first;
  if (!first.cancelled && first.resumeNotFound) {
    log.info('Resume failed (session not found or context overflow) — retrying without --resume');
    result = await runOneAgent(
      {
        agentType: options.type,
        command: resolvedCommand.command,
        cwd: options.cwd || process.cwd(),
        env: commandEnv,
        extraArgs,
        operationId,
        prompt: resolved.prompt,
        uploadImage,
        // No resumeSessionId — start fresh
      },
      false, // no need to intercept resume errors on a fresh run
      'attempt-2-noresume',
    );
  }

  // ─── Drain + finish ───────────────────────────────────────────────────────

  const { code, signal, sessionId } = result;

  if (serverIngester && sink) {
    try {
      await serverIngester.drain();
    } catch (err) {
      log.error(
        'Failed to flush events to server:',
        err instanceof Error ? err.message : String(err),
      );
      result = { ...result, ingestError: true };
    }

    // CC relays API/rate-limit errors as an in-stream terminal `error` event but
    // still exits 0, so the exit code alone would report `success`. Treat any
    // pushed terminal error as a failed run so the topic/task is marked failed.
    const exitedClean =
      !result.cancelled &&
      !result.ingestError &&
      !result.sawTerminalError &&
      (code === 0 || signal === 'SIGTERM');

    // When the run failed, pass an error detail so the server surfaces a useful
    // message instead of the generic "Agent execution failed" fallback. Prefer
    // the in-stream terminal error (CC relays API/rate-limit errors here while
    // exiting 0, so stderr is empty); otherwise fall back to the stderr tail.
    // Trim to the last 1 KB — the tail is most informative and keeps the tRPC
    // payload small.
    const stderrTail = result.stderrContent.trim();
    const errorDetail = result.terminalErrorMessage || stderrTail;
    // The adapter's in-stream classification (overloaded / rate_limit) already
    // carries the structured status-guide body — forward it verbatim instead of
    // re-deriving from the flattened message via the process-only classifier,
    // which would drop `agentType`/`code` and demote the client UI to the
    // generic error card.
    const finishError =
      result.cancelled || exitedClean
        ? undefined
        : result.terminalErrorData
          ? {
              body: { ...result.terminalErrorData },
              message: String(result.terminalErrorData.message ?? errorDetail ?? ''),
              type: 'AgentRuntimeError',
            }
          : errorDetail
            ? buildFinishError(errorDetail.slice(-1024), 'AgentRuntimeError')
            : undefined;

    try {
      await sink.finish({
        error: finishError,
        result: result.cancelled ? 'cancelled' : exitedClean ? 'success' : 'error',
        sessionId,
      });
    } catch (err) {
      log.error('Failed to send heteroFinish:', err instanceof Error ? err.message : String(err));
    }
  }

  // Tear down the AskUserQuestion MCP: stop polling, cancel any in-flight
  // pending (→ CC's tool returns cleanly), close the server, drop the temp
  // config. Best-effort — the process is about to exit anyway.
  askPollAbort.abort();
  if (askServer) {
    askServer.unregisterOperation(operationId);
    await askServer.stop().catch(() => {});
  }
  if (askMcpConfigPath) await unlink(askMcpConfigPath).catch(() => {});

  if (code !== null) process.exit(result.ingestError ? 1 : code);
  if (signal === 'SIGINT') process.exit(130);
  if (signal === 'SIGTERM') process.exit(143);
  if (signal === 'SIGKILL') process.exit(137);
  process.exit(1);
};

export function registerHeteroCommand(program: Command) {
  const hetero = program
    .command('hetero')
    .description(
      'Run heterogeneous agent CLIs (Amp / Claude Code / Codex / OpenCode) and stream their output',
    );

  hetero
    .command('exec')
    .description(
      'Spawn a heterogeneous agent CLI and stream its events as JSONL on stdout. Standalone mode (no server ingest).',
    )
    .requiredOption('-t, --type <type>', `Agent type: ${[...SUPPORTED_AGENT_TYPES].join(' | ')}`)
    .option('-p, --prompt [text]', 'Prompt text. Pass `-` (or omit the value) to read from stdin.')
    .option(
      '-i, --image <path|url>',
      'Attach an image (repeatable). Accepts a local path, http(s) URL, or data: URL.',
      collectImage,
    )
    .option(
      '--input-json <path>',
      'Read full multimodal prompt as JSON content blocks from a file. Use `-` for stdin.',
    )
    .option('-r, --resume <sessionId>', 'Resume an existing agent session by its native id')
    .option('-d, --cwd <path>', 'Working directory for the spawned agent (default: process.cwd())')
    .option('--model <model>', 'Forward a resolved model selection to the agent CLI')
    .option('--effort <level>', 'Forward a resolved reasoning effort selection to the agent CLI')
    .option(
      '--speed <mode>',
      'Forward a resolved speed selection to the agent CLI (codex only; `fast` requests the Fast service tier)',
    )
    .option(
      '--agent-arg <arg>',
      'Forward one native agent CLI argument after wrapper parsing (repeatable)',
      collectAgentArg,
    )
    .option(
      '-c, --command <bin>',
      'Override the agent CLI binary name (default: `amp`, `claude`, `codex`, or `opencode`)',
    )
    .option(
      '--operation-id <id>',
      'Operation id stamped onto every emitted event. Required in server-ingest mode (--topic). Generated as a UUID if omitted (standalone).',
    )
    .option(
      '--topic <topicId>',
      'Server topic id. Enables server-ingest mode: events are batch-POSTed to aiAgent.heteroIngest. Requires --operation-id.',
    )
    .option(
      '--render <mode>',
      'Output mode: jsonl (emit events as JSONL on stdout) | none (suppress stdout). Defaults to jsonl in standalone, none in server-ingest mode.',
    )
    .option(
      '--raw-dump <dir>',
      'Persist the agent process RAW stdout/stderr (pre-adapter stream-json) under <dir>/<timestamp>-<operationId>/ for debugging. Each spawn attempt writes its own .stdout.jsonl / .stderr.log. Best-effort; never affects the run.',
    )
    .action(exec);
}
