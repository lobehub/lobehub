import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentContentBlock,
  AgentImageSource,
  AgentPromptInput,
  AgentStreamEvent,
} from '@lobechat/heterogeneous-agents/spawn';
import { spawnAgent } from '@lobechat/heterogeneous-agents/spawn';
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { log } from '../utils/logger';
import { TrpcIngestSink } from '../utils/TrpcIngestSink';

const SUPPORTED_AGENT_TYPES = new Set(['claude-code', 'codex']);

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
  command?: string;
  cwd?: string;
  image?: string[];
  inputJson?: string;
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
   * Server topic id.  When set, enables server-ingest mode: events are
   * batch-POSTed to `aiAgent.heteroIngest` in addition to (or instead of)
   * being written to stdout.  Requires `--operation-id` to be a valid
   * server-allocated operation id.
   */
  topic?: string;
  type: string;
}

const collectImage = (value: string, previous: string[] = []): string[] => [...previous, value];

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

class SerialServerIngester {
  private accumulatedText = '';
  private fatalError: Error | null = null;
  private inflight: Promise<void> = Promise.resolve();
  private nextSnapshotSeq = 0;
  private pendingTextEvent: AgentStreamEvent | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: TrpcIngestSink,
    private readonly snapshotFlushMs = 200,
  ) {}

  push(event: AgentStreamEvent): void {
    if (this.fatalError) return;

    // Text-snapshot coalescing is a MAIN-AGENT-ONLY transport optimization:
    // it debounces the main agent's token-level text *deltas* into one
    // `replace` snapshot to cut ingest calls. Subagent text is explicitly
    // excluded (`!event.data?.subagent`) for two reasons:
    //   1. Subagent text is emitted as ONE full block per turn (see
    //      claudeCode adapter `handleSubagentAssistant` — "the full block IS
    //      the only emission"), so there is nothing to coalesce.
    //   2. `accumulatedText` is a single shared accumulator with no subagent
    //      scope. Folding subagent blocks in would (a) splice main-agent text
    //      into the subagent message via the shared buffer, and (b) emit a
    //      `replace` snapshot that the server's subagent path *appends*
    //      (`persistSubagentText` has no snapshot semantics) → duplicated /
    //      cross-scope content. Forwarding the raw block straight through lets
    //      the server append it exactly once, correctly.
    if (
      event.type === 'stream_chunk' &&
      event.data?.chunkType === 'text' &&
      typeof event.data?.content === 'string' &&
      !event.data?.subagent
    ) {
      this.accumulatedText += event.data.content;
      this.pendingTextEvent = event;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.queuePendingTextSnapshot();
      }, this.snapshotFlushMs);
      return;
    }

    this.queuePendingTextSnapshot();
    // `accumulatedText` is a PER-MESSAGE accumulator: it coalesces the text
    // deltas of the current assistant message into one `replace` snapshot.
    // A new message boundary (`stream_start` / `stream_end`, emitted by the
    // adapter's `openMainMessage`) must reset it — otherwise it spans the
    // whole run and every later message's snapshot re-emits all prior
    // messages' text verbatim, which the server then persists into the new
    // DB message (LOBE-10157 Bug 3: cross-message text duplication). Reset
    // AFTER flushing the just-ended message's pending snapshot above.
    if (event.type === 'stream_start' || event.type === 'stream_end') {
      this.accumulatedText = '';
    }
    this.enqueue(async () => {
      await this.sink.ingest([event]);
    });
  }

  async drain(): Promise<void> {
    this.queuePendingTextSnapshot();
    try {
      await this.inflight;
    } catch {
      // `fatalError` is re-thrown below.
    }
    if (this.fatalError) throw this.fatalError;
  }

  private enqueue(task: () => Promise<void>) {
    this.inflight = this.inflight.then(task).catch((err) => {
      this.fatalError = err instanceof Error ? err : new Error(String(err));
      throw this.fatalError;
    });
  }

  private queuePendingTextSnapshot() {
    if (!this.pendingTextEvent || this.fatalError) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const baseEvent = this.pendingTextEvent;
    this.pendingTextEvent = undefined;
    const snapshotEvent: AgentStreamEvent = {
      ...baseEvent,
      data: {
        ...baseEvent.data,
        content: this.accumulatedText,
        snapshotMode: 'replace',
        snapshotSeq: ++this.nextSnapshotSeq,
      },
    };

    this.enqueue(async () => {
      await this.sink.ingest([snapshotEvent]);
    });
  }
}

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
  const agentType = options.type as 'claude-code' | 'codex';
  let sink: TrpcIngestSink | undefined;
  let serverIngester: SerialServerIngester | undefined;
  if (serverIngest) {
    const client = await getTrpcClient();
    sink = new TrpcIngestSink(
      client,
      agentType,
      operationId,
      options.topic!,
      process.env.LOBEHUB_ASSISTANT_MESSAGE_ID,
    );
    serverIngester = new SerialServerIngester(sink);
  }

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
   *   sessionId     — CC session id from `system.init` (undefined on resume failure)
   *   ingestError   — true when a batch could not be flushed after retries
   *   resumeNotFound — true when a resume-not-found error was intercepted
   *   stderrContent  — accumulated stderr (only when interceptResumeErrors=true)
   */
  const runOneAgent = async (
    spawnOpts: Parameters<typeof spawnAgent>[0],
    interceptResumeErrors: boolean,
    runLabel: string,
  ): Promise<{
    code: number | null;
    ingestError: boolean;
    resumeNotFound: boolean;
    sessionId: string | undefined;
    signal: NodeJS.Signals | null;
    stderrContent: string;
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
      log.error('Failed to start agent:', err instanceof Error ? err.message : String(err));
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

    // Ctrl-C → SIGINT to the child's process group.
    // Repeated Ctrl-C escalates to SIGKILL.
    let interrupted = false;
    const onSigint = async () => {
      if (interrupted) {
        handle.kill('SIGKILL');
        return;
      }
      interrupted = true;
      handle.kill('SIGINT');
      if (serverIngester && sink) {
        try {
          await serverIngester.drain();
          await sink.finish({ result: 'cancelled' });
        } catch {
          // best-effort; process is exiting anyway
        }
      }
    };
    const onSigterm = async () => {
      handle.kill('SIGTERM');
      if (serverIngester && sink) {
        try {
          await serverIngester.drain();
          await sink.finish({ result: 'cancelled' });
        } catch {
          // best-effort
        }
      }
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    // Stream events. Each event is optionally written as JSONL and pushed
    // into the ingester.  When intercepting resume errors, a matching
    // `error` event is withheld from the ingester and flags a retry instead.
    let resumeNotFound = false;
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
          await sink.finish({
            error: { message: String(err), type: 'stream_error' },
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

    const { code, signal } = await handle.exit;
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
      code,
      ingestError,
      resumeNotFound,
      sessionId: handle.sessionId,
      signal,
      stderrContent,
    };
  };

  // ─── First run (with --resume if provided) ───────────────────────────────

  const interceptResume = !!options.resume;
  const first = await runOneAgent(
    {
      agentType: options.type,
      command: options.command,
      cwd: options.cwd || process.cwd(),
      operationId,
      prompt: resolved.prompt,
      resumeSessionId: options.resume,
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
  if (first.resumeNotFound) {
    log.info('Resume failed (session not found or context overflow) — retrying without --resume');
    result = await runOneAgent(
      {
        agentType: options.type,
        command: options.command,
        cwd: options.cwd || process.cwd(),
        operationId,
        prompt: resolved.prompt,
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

    const exitedClean = !result.ingestError && (code === 0 || signal === 'SIGTERM');

    // When the run failed, pass stderr as the error detail so the server can
    // surface a useful message instead of the generic "Agent execution failed"
    // fallback.  Trim to the last 1 KB — the tail is most informative and
    // keeps the tRPC payload small.
    const stderrTail = result.stderrContent.trim();
    const finishError =
      !exitedClean && stderrTail
        ? { message: stderrTail.slice(-1024), type: 'AgentRuntimeError' }
        : undefined;

    try {
      await sink.finish({
        error: finishError,
        result: exitedClean ? 'success' : 'error',
        sessionId,
      });
    } catch (err) {
      log.error('Failed to send heteroFinish:', err instanceof Error ? err.message : String(err));
    }
  }

  if (code !== null) process.exit(result.ingestError ? 1 : code);
  if (signal === 'SIGINT') process.exit(130);
  if (signal === 'SIGTERM') process.exit(143);
  if (signal === 'SIGKILL') process.exit(137);
  process.exit(1);
};

export function registerHeteroCommand(program: Command) {
  const hetero = program
    .command('hetero')
    .description('Run heterogeneous agent CLIs (Claude Code / Codex) and stream their output');

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
    .option(
      '-c, --command <bin>',
      'Override the agent CLI binary name (default: `claude` or `codex`)',
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
