import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import { StringDecoder } from 'node:string_decoder';

import type { VerifyTerminalOutcome, VerifyTerminalTruncation } from '@lobechat/types';
import type { AsciicastEvent } from '@lobechat/utils/verify/asciicast';
import type { IPty } from '@lydell/node-pty';

import { loadPty } from '../pty';

/**
 * Run one command and observe it — the capture half of terminal evidence.
 *
 * Every way the run can end keeps its own meaning: an exit status, a signal, a
 * timeout, an interrupt, a command that never started, and a capture that broke
 * are different outcomes, and none of them is rewritten by what happens to the
 * evidence afterwards. Whatever was collected before the end is kept.
 */

export type CaptureMode = 'pipe' | 'pty';

export interface CaptureOptions {
  /** Command and arguments; with `shell`, joined and run by the shell. */
  argv: string[];
  cols: number;
  cwd: string;
  /** Mirror the command's output live to this process. */
  echo: boolean;
  env?: NodeJS.ProcessEnv;
  /** Bytes kept per stream (pipe) or for the whole recording (pty). */
  maxBytes: number;
  mode: CaptureMode;
  rows: number;
  shell: boolean;
  timeoutMs?: number;
}

export interface CaptureResult {
  cols: number;
  error: string | null;
  /** pty: output and resize events with real timing. Never input. */
  events: AsciicastEvent[];
  exitCode: number | null;
  finishedAt: Date;
  outcome: VerifyTerminalOutcome;
  rows: number;
  signal: string | null;
  startedAt: Date;
  /** pipe only. */
  stderr: string | null;
  stdout: string | null;
  truncation: VerifyTerminalTruncation[];
}

/** Grace period between the polite SIGTERM of a timeout and the SIGKILL. */
const KILL_GRACE_MS = 3000;

const signalName = (signal: number | string | null | undefined): string | null => {
  if (signal === null || signal === undefined || signal === 0) return null;
  if (typeof signal === 'string') return signal;
  const entry = Object.entries(os.constants.signals).find(([, value]) => value === signal);
  return entry?.[0] ?? `signal ${signal}`;
};

/** POSIX-quote one argument for display. */
export const quoteArg = (arg: string): string =>
  /^[\w%+,./:=@-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;

export const displayCommand = (argv: string[], shell: boolean) =>
  shell ? argv.join(' ') : argv.map(quoteArg).join(' ');

/**
 * Keep the head and the tail of a stream past its budget — a failing command
 * says why at the end, and a summary at the start says what it was doing — and
 * count what was dropped in between.
 */
class HeadTailBuffer {
  private head: Buffer[] = [];
  private headBytes = 0;
  private tail: Buffer[] = [];
  private tailBytes = 0;
  dropped = 0;
  total = 0;

  constructor(private limit: number) {}

  push(chunk: Buffer) {
    this.total += chunk.length;
    const headLimit = Math.floor(this.limit / 2);
    if (this.headBytes < headLimit) {
      const take = Math.min(chunk.length, headLimit - this.headBytes);
      this.head.push(chunk.subarray(0, take));
      this.headBytes += take;
      chunk = chunk.subarray(take);
      if (chunk.length === 0) return;
    }
    this.tail.push(chunk);
    this.tailBytes += chunk.length;
    const tailLimit = this.limit - headLimit;
    while (this.tailBytes > tailLimit) {
      const excess = this.tailBytes - tailLimit;
      const first = this.tail[0];
      if (first.length <= excess) {
        this.tail.shift();
        this.tailBytes -= first.length;
        this.dropped += first.length;
      } else {
        this.tail[0] = first.subarray(excess);
        this.tailBytes -= excess;
        this.dropped += excess;
      }
    }
  }

  /**
   * Decode once, at the end. Nothing dropped: head and tail are one contiguous
   * stream, decoded together so a character split across their boundary stays
   * whole. Something dropped: each side is cut back to a character boundary
   * (the partial bytes count as dropped too) rather than decoded into U+FFFD.
   */
  read(): { dropped: number; kept: number; text: string } {
    const head = Buffer.concat(this.head);
    const tail = Buffer.concat(this.tail);
    if (this.dropped === 0)
      return { dropped: 0, kept: this.total, text: Buffer.concat([head, tail]).toString('utf8') };
    const headEnd = completeUtf8Length(head);
    const tailStart = utf8BoundaryOffset(tail);
    const dropped = this.dropped + (head.length - headEnd) + tailStart;
    return {
      dropped,
      kept: this.total - dropped,
      text: `${head.subarray(0, headEnd).toString('utf8')}\n[… ${dropped} bytes truncated by the capturer …]\n${tail.subarray(tailStart).toString('utf8')}`,
    };
  }
}

/** Bytes a UTF-8 sequence starting with this lead byte spans, or 0 for a continuation byte. */
const utf8SequenceLength = (byte: number) =>
  byte < 0x80 ? 1 : byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 0;

/** Length of `buf` without a trailing character the cut left incomplete. */
export const completeUtf8Length = (buf: Buffer): number => {
  for (let i = buf.length - 1; i >= Math.max(0, buf.length - 4); i--) {
    const length = utf8SequenceLength(buf[i]);
    if (length === 0) continue;
    return i + length <= buf.length ? buf.length : i;
  }
  return buf.length;
};

/** Leading continuation bytes left over from a character the cut began inside. */
export const utf8BoundaryOffset = (buf: Buffer): number => {
  let offset = 0;
  while (offset < Math.min(3, buf.length) && utf8SequenceLength(buf[offset]) === 0) offset += 1;
  return offset;
};

/** Every process below `root`, from one `ps` snapshot. Empty when it cannot be read. */
const descendantPids = (root: number): number[] => {
  let table: string;
  try {
    table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const children = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
};

/**
 * Signal a command and everything it started. A `--shell` capture runs the
 * command under a shell whose children hold the output pipes; signalling only
 * the shell left them running, so a timeout did not bound the run. Descendants
 * are remembered on the first signal: once their parent dies they are
 * reparented, and the escalation must still reach them.
 */
const signalTree = (root: number | undefined, signal: NodeJS.Signals, known: Set<number>) => {
  if (!root) return;
  if (process.platform === 'win32') {
    // taskkill /T walks the tree itself; there is no graceful signal to send.
    spawn('taskkill', ['/pid', String(root), '/T', '/F'], { stdio: 'ignore' }).on(
      'error',
      () => {},
    );
    return;
  }
  for (const pid of descendantPids(root)) known.add(pid);
  for (const pid of [root, ...known]) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
};

/** Mark the run interrupted when this process is told to stop, and pass the stop on. */
const onInterrupt = (handler: (signal: NodeJS.Signals) => void) => {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, handler);
  return () => {
    for (const signal of signals) process.off(signal, handler);
  };
};

const capturePipe = (options: CaptureOptions): Promise<CaptureResult> =>
  new Promise((resolve) => {
    const startedAt = new Date();
    const stdout = new HeadTailBuffer(options.maxBytes);
    const stderr = new HeadTailBuffer(options.maxBytes);
    let timedOut = false;
    let interrupted: NodeJS.Signals | null = null;
    let spawnError: Error | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    const [file, ...args] = options.argv;
    const child = options.shell
      ? spawn(options.argv.join(' '), {
          cwd: options.cwd,
          env: options.env,
          shell: true,
          stdio: ['inherit', 'pipe', 'pipe'],
        })
      : spawn(file, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: ['inherit', 'pipe', 'pipe'],
        });

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.echo) process.stdout.write(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.echo) process.stderr.write(chunk);
    });

    const tree = new Set<number>();
    const terminate = () => {
      signalTree(child.pid, 'SIGTERM', tree);
      killTimer = setTimeout(() => signalTree(child.pid, 'SIGKILL', tree), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            terminate();
          }, options.timeoutMs);
    const release = onInterrupt((signal) => {
      interrupted = signal;
      // The child shares the terminal's process group and usually got the
      // signal already; forwarding covers the non-interactive case.
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    });

    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      release();
      const finishedAt = new Date();
      const signalText = signalName(signal);
      const outcome: VerifyTerminalOutcome = spawnError
        ? 'spawn_failed'
        : timedOut
          ? 'timed_out'
          : interrupted
            ? 'interrupted'
            : signalText
              ? 'signaled'
              : 'exited';
      const out = stdout.read();
      const err = stderr.read();
      const truncation: VerifyTerminalTruncation[] = [];
      for (const [stream, read] of [
        ['stdout', out],
        ['stderr', err],
      ] as const)
        if (read.dropped > 0)
          truncation.push({ droppedBytes: read.dropped, keptBytes: read.kept, stream });
      resolve({
        cols: options.cols,
        error: spawnError ? (spawnError as Error).message : null,
        events: [],
        exitCode: spawnError ? null : code,
        finishedAt,
        outcome,
        rows: options.rows,
        signal: signalText ?? (interrupted || null),
        startedAt,
        stderr: err.text,
        stdout: out.text,
        truncation,
      });
    });
  });

export class PtyUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `PTY capture is unavailable in this CLI installation (${reason}). ` +
        'Install @lobehub/cli from npm on a supported platform to record a terminal session, ' +
        'or capture with --mode pipe — it keeps stdout and stderr but records no terminal behavior ' +
        '(TUI drawing, cursor movement, resizes), and the evidence will say pipe, not pty.',
    );
    this.name = 'PtyUnavailableError';
  }
}

const capturePty = async (options: CaptureOptions): Promise<CaptureResult> => {
  // node-pty loads under Bun but never delivers output or exit, so a capture
  // would hang forever; the published CLI runs on Node.
  if (process.versions.bun)
    throw new PtyUnavailableError('the Bun runtime cannot drive node-pty; run the CLI with Node');
  let pty: Awaited<ReturnType<typeof loadPty>>;
  try {
    pty = await loadPty();
  } catch (error) {
    throw new PtyUnavailableError(error instanceof Error ? error.message : String(error));
  }

  const startedAt = new Date();
  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;
  const events: AsciicastEvent[] = [];
  let recordedBytes = 0;
  let droppedBytes = 0;
  let cols = options.cols;
  let rows = options.rows;

  const shellPath =
    process.platform === 'win32'
      ? process.env.ComSpec || 'cmd.exe'
      : process.env.SHELL || '/bin/sh';
  const [file, args] = options.shell
    ? [
        shellPath,
        process.platform === 'win32'
          ? ['/d', '/s', '/c', options.argv.join(' ')]
          : ['-c', options.argv.join(' ')],
      ]
    : [options.argv[0], options.argv.slice(1)];

  let child: IPty;
  try {
    child = pty.spawn(file, args, {
      cols,
      cwd: options.cwd,
      env: { ...options.env, COLORTERM: 'truecolor', TERM: 'xterm-256color' } as Record<
        string,
        string
      >,
      name: 'xterm-256color',
      rows,
    });
  } catch (error) {
    const finishedAt = new Date();
    return {
      cols,
      error: error instanceof Error ? error.message : String(error),
      events,
      exitCode: null,
      finishedAt,
      outcome: 'spawn_failed',
      rows,
      signal: null,
      startedAt,
      stderr: null,
      stdout: null,
      truncation: [],
    };
  }

  const decoder = new StringDecoder('utf8');
  return new Promise((resolve) => {
    let timedOut = false;
    let interrupted: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    child.onData((data) => {
      if (options.echo) process.stdout.write(data);
      const bytes = Buffer.byteLength(data);
      if (recordedBytes + bytes > options.maxBytes) {
        droppedBytes += bytes;
        return;
      }
      recordedBytes += bytes;
      events.push({ code: 'o', data, t: now() });
    });

    // A human at a real terminal can drive the session; their keystrokes reach
    // the program but are never recorded. Piped stdin is forwarded the same way,
    // so a script can feed a TUI its input.
    const stdin = process.stdin;
    const rawMode = stdin.isTTY && typeof stdin.setRawMode === 'function';
    if (rawMode) stdin.setRawMode(true);
    const forward = (chunk: Buffer) => child.write(decoder.write(chunk));
    stdin.on('data', forward);
    stdin.resume();

    const onResize = () => {
      if (!process.stdout.columns || !process.stdout.rows) return;
      cols = process.stdout.columns;
      rows = process.stdout.rows;
      child.resize(cols, rows);
      events.push({ code: 'r', data: `${cols}x${rows}`, t: now() });
    };
    if (process.stdout.isTTY) process.stdout.on('resize', onResize);

    const tree = new Set<number>();
    const terminate = () => {
      signalTree(child.pid, 'SIGTERM', tree);
      killTimer = setTimeout(() => signalTree(child.pid, 'SIGKILL', tree), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            terminate();
          }, options.timeoutMs);
    const release = onInterrupt((signal) => {
      interrupted = signal;
      child.kill(signal);
    });

    child.onExit(({ exitCode, signal }) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      release();
      stdin.off('data', forward);
      if (rawMode) stdin.setRawMode(false);
      stdin.pause();
      if (process.stdout.isTTY) process.stdout.off('resize', onResize);

      const signalText = signalName(signal);
      const outcome: VerifyTerminalOutcome = timedOut
        ? 'timed_out'
        : interrupted
          ? 'interrupted'
          : signalText
            ? 'signaled'
            : 'exited';
      const code = signalText ? null : exitCode;
      events.push({ code: 'x', data: String(code ?? exitCode), t: now() });
      resolve({
        cols: options.cols,
        error: null,
        events,
        exitCode: code,
        finishedAt: new Date(),
        outcome,
        rows: options.rows,
        signal: signalText ?? (interrupted || null),
        startedAt,
        stderr: null,
        stdout: null,
        truncation:
          droppedBytes > 0 ? [{ droppedBytes, keptBytes: recordedBytes, stream: 'cast' }] : [],
      });
    });
  });
};

export const captureCommand = (options: CaptureOptions): Promise<CaptureResult> =>
  options.mode === 'pty' ? capturePty(options) : capturePipe(options);
