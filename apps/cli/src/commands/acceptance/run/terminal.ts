import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type {
  VerifyTerminalEvidenceMetadata,
  VerifyTerminalOutcome,
  VerifyTerminalSourceKind,
  VerifyTerminalTruncation,
} from '@lobechat/types';
import {
  AsciicastError,
  type AsciicastEvent,
  encodeAsciicastV3,
  parseAsciicast,
} from '@lobechat/utils/verify/asciicast';
import {
  describeTerminalOutcome,
  terminalTextFromStream,
} from '@lobechat/utils/verify/terminalEvidence';
import type { Command } from 'commander';
import pc from 'picocolors';

import { cliVersion } from '../../../pkg';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import {
  loadTerminalBundle,
  prepareBundleDir,
  terminalEvidenceDescription,
  type TerminalRecordDraft,
  writeTerminalBundle,
} from '../../../utils/terminalEvidence/bundle';
import {
  captureCommand,
  type CaptureMode,
  displayCommand,
  PtyUnavailableError,
} from '../../../utils/terminalEvidence/capture';
import {
  createRedactor,
  redactChunks,
  RedactionLog,
  type Redactor,
  redactText,
} from '../../../utils/terminalEvidence/redact';
import { INLINE_TEXT_EVIDENCE_LIMIT } from '../utils';

/**
 * `lh acceptance run evidence capture|import` — terminal evidence for CLI
 * acceptance. Both write a local bundle (see `utils/terminalEvidence/bundle`)
 * and stop: publishing is a separate `upload` / `result submit` / `ingest`
 * step, so the author can read exactly what will leave the machine first.
 */

/** Per-stream budget: enough for any real log, small enough to review and store. */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Environment facts worth recording; nothing else from the environment is read. */
const ENV_ALLOWLIST = ['CI', 'LANG', 'TERM'] as const;

const environmentSummary = (): Record<string, string> => {
  const summary: Record<string, string> = {
    lh: cliVersion,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
  if (process.env.SHELL) summary.shell = path.basename(process.env.SHELL);
  for (const name of ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value) summary[name] = value;
  }
  return summary;
};

const redactRecord = (redactor: Redactor, redactions: RedactionLog, value: string | null) =>
  value === null ? null : redactText(redactor, redactions, value);

const redactEnv = (redactor: Redactor, redactions: RedactionLog, env: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, redactText(redactor, redactions, value)]),
  );

const positiveInt = (raw: string | undefined, flag: string): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
};

const fail = (message: string): never => {
  log.error(message);
  process.exit(1);
};

const capturer = { name: 'lh', version: cliVersion };

const printBundleSummary = (
  dir: string,
  metadata: VerifyTerminalEvidenceMetadata,
  json: boolean | string | undefined,
) => {
  if (json !== undefined) {
    outputJson(
      { dir: path.resolve(dir), ...metadata },
      typeof json === 'string' ? json : undefined,
    );
    return;
  }
  const { execution, processing, source, capture } = metadata;
  const ok = execution.outcome === 'exited' && execution.exitCode === 0;
  const outcome = describeTerminalOutcome(execution);
  console.error(
    `${ok ? pc.green('✓') : pc.yellow('!')} ${source.kind} (${capture.mode}) · ${ok ? outcome : pc.yellow(outcome)}` +
      (execution.durationMs === null ? '' : ` · ${(execution.durationMs / 1000).toFixed(2)}s`),
  );
  if (processing.redactions.length)
    console.error(
      `  redacted: ${processing.redactions.map((r) => `${r.rule} ×${r.count}`).join(', ')}`,
    );
  for (const t of processing.truncation)
    console.error(`  truncated ${t.stream}: dropped ${t.droppedBytes} bytes`);
  if (processing.missingFields.length)
    console.error(`  unknown: ${processing.missingFields.join(', ')}`);
  console.error(`  bundle: ${path.resolve(dir)}`);
  console.error(
    pc.dim(
      `  review it, then publish: lh acceptance run result submit --run <runId> --item <itemId> --terminal ${dir}`,
    ),
  );
};

// ── capture ──

interface CaptureCliOptions {
  cols?: string;
  cwd?: string;
  echo?: boolean;
  force?: boolean;
  json?: boolean | string;
  maxBytes?: string;
  mode: string;
  out: string;
  redact?: string[];
  rows?: string;
  shell?: boolean;
  timeout?: string;
}

async function captureAction(argv: string[], options: CaptureCliOptions): Promise<void> {
  if (argv.length === 0)
    fail('Give the command to run after --, e.g. `capture --out ./ev -- ls -la`');
  if (options.mode !== 'pipe' && options.mode !== 'pty') fail('--mode must be pipe or pty');
  const mode = options.mode as CaptureMode;

  let cols: number, rows: number, maxBytes: number, timeoutSeconds: number | undefined;
  try {
    cols =
      positiveInt(options.cols, '--cols') ??
      (process.stdout.isTTY ? process.stdout.columns : 0) ??
      0;
    rows =
      positiveInt(options.rows, '--rows') ?? (process.stdout.isTTY ? process.stdout.rows : 0) ?? 0;
    cols = Math.min(cols || 80, 1000);
    rows = Math.min(rows || 24, 500);
    maxBytes = positiveInt(options.maxBytes, '--max-bytes') ?? DEFAULT_MAX_BYTES;
    timeoutSeconds = positiveInt(options.timeout, '--timeout');
  } catch (error) {
    return fail((error as Error).message);
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) fail(`--cwd ${cwd} is not a directory`);

  try {
    prepareBundleDir(options.out, Boolean(options.force));
  } catch (error) {
    return fail((error as Error).message);
  }

  // `--json` keeps stdout for the record alone, so the command's own output
  // is not mirrored there; it is all in the bundle.
  const echo = options.echo !== false && options.json === undefined;
  let result;
  try {
    result = await captureCommand({
      argv,
      cols,
      cwd,
      echo,
      env: process.env,
      maxBytes,
      mode,
      rows,
      shell: Boolean(options.shell),
      timeoutMs: timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000,
    });
  } catch (error) {
    if (error instanceof PtyUnavailableError) return fail(error.message);
    return fail(`Capture failed before the command produced a result: ${(error as Error).message}`);
  }

  const redactor = createRedactor({ custom: options.redact });
  const redactions = new RedactionLog();
  const command = redactText(redactor, redactions, displayCommand(argv, Boolean(options.shell)));

  let content: { cast?: string; output?: string; stderr?: string; stdout?: string };
  if (mode === 'pty') {
    // Redact the output events as one stream (a secret split across two writes
    // is still caught), then derive the plain text from the redacted events.
    const outputEvents = result.events.filter((event) => event.code === 'o');
    const redacted = redactChunks(
      redactor,
      redactions,
      outputEvents.map((event) => event.data),
    );
    let o = 0;
    const events: AsciicastEvent[] = result.events.map((event) =>
      event.code === 'o' ? { ...event, data: redacted[o++] } : event,
    );
    content = {
      cast: encodeAsciicastV3(
        {
          cols: result.cols,
          command,
          rows: result.rows,
          termType: 'xterm-256color',
          timestamp: result.startedAt.getTime() / 1000,
        },
        events,
      ),
      output: terminalTextFromStream(redacted.join('')),
    };
  } else {
    content = {
      stderr: redactText(redactor, redactions, result.stderr ?? ''),
      stdout: redactText(redactor, redactions, result.stdout ?? ''),
    };
  }

  const draft: TerminalRecordDraft = {
    capture: {
      capturer,
      mode,
      streamLayout: mode === 'pty' ? 'merged' : 'separate',
      terminal:
        mode === 'pty' ? { cols: result.cols, rows: result.rows, type: 'xterm-256color' } : null,
      timing: mode === 'pty' ? 'recorded' : 'unavailable',
    },
    execution: {
      command,
      cwd: redactText(redactor, redactions, cwd),
      durationMs: result.finishedAt.getTime() - result.startedAt.getTime(),
      environmentSummary: redactEnv(redactor, redactions, environmentSummary()),
      error: redactRecord(redactor, redactions, result.error),
      exitCode: result.exitCode,
      finishedAt: result.finishedAt.toISOString(),
      outcome: result.outcome,
      signal: result.signal,
      startedAt: result.startedAt.toISOString(),
    },
    processing: {
      missingFields: result.exitCode === null ? ['execution.exitCode'] : [],
      notes:
        mode === 'pty'
          ? ['pty output is one merged terminal stream; stderr is not separable.']
          : [],
      redactions: redactions.toJSON(),
      truncation: result.truncation,
    },
    source: { kind: 'captured', originalRecordRef: null, originalTool: null },
    version: 1,
  };

  let written;
  try {
    written = writeTerminalBundle(options.out, draft, content);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (echo) process.stdout.write('\n');
  printBundleSummary(options.out, written.metadata, options.json);
}

// ── import ──

interface ImportCliOptions {
  cast?: string;
  command?: string;
  cwd?: string;
  exitCode?: string;
  finishedAt?: string;
  force?: boolean;
  input?: string;
  json?: boolean | string;
  maxBytes?: string;
  metadata?: string;
  out: string;
  recordRef?: string;
  redact?: string[];
  signal?: string;
  source: string;
  startedAt?: string;
  stderr?: string;
  stdout?: string;
  tool?: string;
}

/** Fields an import may state about the run it came from — the doc's metadata shape, all optional. */
interface ImportFacts {
  execution?: {
    command?: string | null;
    cwd?: string | null;
    environmentSummary?: Record<string, string>;
    exitCode?: number | null;
    finishedAt?: string | null;
    signal?: string | null;
    startedAt?: string | null;
  };
  source?: { originalRecordRef?: string | null; originalTool?: string | null };
}

const readTextInput = (file: string, flag: string, maxBytes: number) => {
  if (!existsSync(file) || !statSync(file).isFile())
    throw new Error(`${flag} ${file} is not a file`);
  const buffer = readFileSync(file);
  if (buffer.includes(0)) throw new Error(`${flag} ${file} is binary; import text output only`);
  if (buffer.length <= maxBytes)
    return { dropped: 0, kept: buffer.length, text: buffer.toString('utf8') };
  const half = Math.floor(maxBytes / 2);
  const dropped = buffer.length - 2 * half;
  return {
    dropped,
    kept: 2 * half,
    text: `${buffer.subarray(0, half).toString('utf8')}\n[… ${dropped} bytes truncated on import …]\n${buffer.subarray(buffer.length - half).toString('utf8')}`,
  };
};

const isoOrNull = (value: string | null | undefined, flag: string) => {
  if (value === undefined || value === null) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`${flag} must be an ISO 8601 timestamp`);
  return new Date(time).toISOString();
};

function buildImport(options: ImportCliOptions) {
  const sources = [options.input, options.stdout, options.stderr, options.cast].filter(Boolean);
  if (sources.length === 0)
    throw new Error(
      'Give the existing output to import: --input, --stdout/--stderr, and/or --cast',
    );
  if (options.input && (options.stdout || options.stderr))
    throw new Error('--input is merged output; use it or --stdout/--stderr, not both');
  if (options.source !== 'imported' && options.source !== 'authored')
    throw new Error('--source must be imported or authored');
  const kind = options.source as VerifyTerminalSourceKind;
  const maxBytes = positiveInt(options.maxBytes, '--max-bytes') ?? DEFAULT_MAX_BYTES;

  let facts: ImportFacts = {};
  if (options.metadata) {
    try {
      facts = JSON.parse(readFileSync(options.metadata, 'utf8')) as ImportFacts;
    } catch (error) {
      throw new Error(`--metadata ${options.metadata}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    if (typeof facts !== 'object' || facts === null || Array.isArray(facts))
      throw new Error('--metadata must be a JSON object');
  }

  const notes: string[] = [];
  const truncation: VerifyTerminalTruncation[] = [];
  const read = (
    file: string | undefined,
    flag: string,
    stream: VerifyTerminalTruncation['stream'],
  ) => {
    if (!file) return undefined;
    const input = readTextInput(file, flag, maxBytes);
    if (input.dropped > 0)
      truncation.push({ droppedBytes: input.dropped, keptBytes: input.kept, stream });
    return input.text;
  };

  // A recording is replayed only if it is a valid one; a broken file is
  // refused here instead of publishing as an unplayable "recording".
  let cast;
  if (options.cast) {
    const raw = readFileSync(options.cast, 'utf8');
    try {
      cast = parseAsciicast(raw);
    } catch (error) {
      if (error instanceof AsciicastError)
        throw new Error(`--cast ${options.cast}: ${error.message}`, { cause: error });
      throw error;
    }
    if (cast.version === 2)
      notes.push('Converted the asciicast v2 recording to v3; event timing is unchanged.');
  }

  const execution = facts.execution ?? {};
  const exitCodeFlag = options.exitCode === undefined ? undefined : Number(options.exitCode);
  if (exitCodeFlag !== undefined && !Number.isInteger(exitCodeFlag))
    throw new Error('--exit-code must be an integer');

  let command = options.command ?? execution.command ?? null;
  let exitCode = exitCodeFlag ?? execution.exitCode ?? null;
  let startedAt = isoOrNull(options.startedAt ?? execution.startedAt, '--started-at');
  let finishedAt = isoOrNull(options.finishedAt ?? execution.finishedAt, '--finished-at');
  // Facts the recording itself carries are real observations, not inferences
  // from how the output looks — use them, and say where they came from.
  if (cast) {
    if (command === null && cast.command) {
      command = cast.command;
      notes.push('execution.command taken from the recording header.');
    }
    if (exitCode === null && cast.exitStatus !== null) {
      exitCode = cast.exitStatus;
      notes.push('execution.exitCode taken from the recording exit event.');
    }
    if (startedAt === null && cast.timestamp !== null) {
      startedAt = new Date(cast.timestamp * 1000).toISOString();
      notes.push('execution.startedAt taken from the recording header.');
      if (finishedAt === null) {
        finishedAt = new Date((cast.timestamp + cast.duration) * 1000).toISOString();
        notes.push('execution.finishedAt is the recording start plus its duration.');
      }
    }
  }
  const signal = options.signal ?? execution.signal ?? null;
  const durationMs =
    startedAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : null;
  const outcome: VerifyTerminalOutcome = signal
    ? 'signaled'
    : exitCode === null
      ? 'unknown'
      : 'exited';
  const cwd = options.cwd ?? execution.cwd ?? null;

  const fields: [string, unknown][] = [
    ['execution.command', command],
    ['execution.cwd', cwd],
    ['execution.exitCode', signal ? 0 : exitCode],
    ['execution.startedAt', startedAt],
    ['execution.finishedAt', finishedAt],
  ];
  const missingFields = fields.filter(([, value]) => value === null).map(([name]) => name);

  return {
    cast,
    draft: {
      command,
      cwd,
      durationMs,
      environmentSummary: execution.environmentSummary ?? {},
      exitCode: signal ? null : exitCode,
      finishedAt,
      kind,
      missingFields,
      notes,
      originalRecordRef: options.recordRef ?? facts.source?.originalRecordRef ?? null,
      originalTool: options.tool ?? facts.source?.originalTool ?? null,
      outcome,
      signal,
      startedAt,
      truncation,
    },
    input: read(options.input, '--input', 'output'),
    stderr: read(options.stderr, '--stderr', 'stderr'),
    stdout: read(options.stdout, '--stdout', 'stdout'),
  };
}

async function importAction(options: ImportCliOptions): Promise<void> {
  let built: ReturnType<typeof buildImport>;
  try {
    built = buildImport(options);
    prepareBundleDir(options.out, Boolean(options.force));
  } catch (error) {
    return fail((error as Error).message);
  }
  const { cast, draft, input, stderr, stdout } = built;

  const redactor = createRedactor({ custom: options.redact });
  const redactions = new RedactionLog();
  const command = redactRecord(redactor, redactions, draft.command);

  let castText: string | undefined;
  let output: string | undefined;
  if (cast) {
    const outputEvents = cast.events.filter((event) => event.code === 'o');
    const redacted = redactChunks(
      redactor,
      redactions,
      outputEvents.map((event) => event.data),
    );
    let o = 0;
    // Input events are never kept: keystrokes can hold anything typed.
    const events = cast.events
      .filter((event) => event.code !== 'i')
      .map((event) => (event.code === 'o' ? { ...event, data: redacted[o++] } : event));
    if (cast.events.some((event) => event.code === 'i'))
      draft.notes.push('Dropped recorded keyboard input events.');
    castText = encodeAsciicastV3(
      {
        cols: cast.cols,
        command,
        rows: cast.rows,
        termType: cast.termType,
        timestamp: cast.timestamp,
      },
      events,
    );
    output = input === undefined ? terminalTextFromStream(redacted.join('')) : undefined;
  }
  // Imported logs often carry color codes; the bundle keeps their plain text and says so.
  const plain = (text: string | undefined, flag: string) => {
    if (text === undefined) return undefined;
    const stripped = terminalTextFromStream(text);
    if (stripped !== text) draft.notes.push(`Removed terminal control sequences from ${flag}.`);
    return redactText(redactor, redactions, stripped);
  };
  if (input !== undefined) output = plain(input, '--input');
  const stdoutText = plain(stdout, '--stdout');
  const stderrText = plain(stderr, '--stderr');
  const separate = stdout !== undefined || stderr !== undefined;
  const originalRecordRef = redactRecord(redactor, redactions, draft.originalRecordRef);

  const metadataDraft: TerminalRecordDraft = {
    capture: {
      capturer,
      mode: 'import',
      streamLayout: separate ? 'separate' : output === undefined ? 'unknown' : 'merged',
      terminal: cast ? { cols: cast.cols, rows: cast.rows, type: cast.termType } : null,
      timing: cast ? 'recorded' : 'unavailable',
    },
    execution: {
      command,
      cwd: redactRecord(redactor, redactions, draft.cwd),
      durationMs: draft.durationMs,
      environmentSummary: redactEnv(redactor, redactions, draft.environmentSummary),
      error: null,
      exitCode: draft.exitCode,
      finishedAt: draft.finishedAt,
      outcome: draft.outcome,
      signal: draft.signal,
      startedAt: draft.startedAt,
    },
    processing: {
      missingFields: draft.missingFields,
      notes: draft.notes,
      redactions: redactions.toJSON(),
      truncation: draft.truncation,
    },
    source: {
      kind: draft.kind,
      originalRecordRef,
      originalTool: draft.originalTool,
    },
    version: 1,
  };
  let written;
  try {
    written = writeTerminalBundle(options.out, metadataDraft, {
      cast: castText,
      output: separate ? undefined : output,
      stderr: stderrText,
      stdout: stdoutText,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  printBundleSummary(options.out, written.metadata, options.json);
}

// ── publish ──

export interface TerminalEvidencePayload {
  content?: string;
  description: string;
  fileId?: string;
  metadata: { terminal: VerifyTerminalEvidenceMetadata };
  type: 'terminal';
}

/**
 * Upload a bundle's files and return the evidence to attach. Artifacts upload
 * first so the record can name their file ids; the transcript travels inline
 * when it is small, like any other text evidence.
 */
export async function publishTerminalBundle(
  upload: (file: string) => Promise<{ id: string }>,
  target: string,
  description?: string,
): Promise<TerminalEvidencePayload> {
  const bundle = loadTerminalBundle(target);
  const metadata = structuredClone(bundle.metadata);
  for (const [key, file] of Object.entries(bundle.artifactFiles)) {
    const artifact = metadata.artifacts[key as keyof typeof metadata.artifacts]!;
    artifact.fileId = (await upload(file!)).id;
  }
  const inline =
    bundle.transcript.length > 0 && bundle.transcript.length < INLINE_TEXT_EVIDENCE_LIMIT;
  return {
    content: inline ? bundle.transcript : undefined,
    description: description?.trim() || terminalEvidenceDescription(metadata),
    fileId: inline ? undefined : (await upload(bundle.transcriptFile)).id,
    metadata: { terminal: metadata },
    type: 'terminal',
  };
}

// ── registration ──

const collect = (value: string, previous: string[] = []) => [...previous, value];

export function attachTerminalEvidenceCommands(evidence: Command): void {
  evidence
    .command('capture')
    .description(
      'Run a command and write a terminal evidence bundle (output, exit status, optional pty recording) for review before publishing',
    )
    .argument('<command...>', 'The command to run, after --')
    .requiredOption('--out <dir>', 'Bundle directory to write')
    .option('--mode <mode>', 'pipe (stdout/stderr kept apart) | pty (terminal recording)', 'pipe')
    .option('--cwd <dir>', 'Working directory for the command')
    .option('--shell', 'Run the command through the shell (pipes, globs, &&)')
    .option('--timeout <seconds>', 'Stop the command after this long (recorded as timed out)')
    .option('--cols <n>', 'pty width (default: this terminal, else 80)')
    .option('--rows <n>', 'pty height (default: this terminal, else 24)')
    .option(
      '--max-bytes <n>',
      'Bytes kept per stream; the middle of longer output is dropped and recorded',
    )
    .option(
      '--redact <pattern>',
      'Extra text or /regex/ to mask before writing (repeatable)',
      collect,
    )
    .option('--no-echo', 'Do not mirror the command output while it runs')
    .option('--force', 'Replace an existing bundle in --out')
    .option('--json [fields]', 'Print the record as JSON instead of a summary')
    .addHelpText(
      'after',
      `
The bundle is written already redacted; nothing is uploaded. Read it, then publish:
  lh acceptance run result submit --run <runId> --item <itemId> --terminal <dir>
  lh acceptance run evidence upload --check <checkResultId> --terminal <dir>
or list the directory as a case's evidence path for \`lh acceptance run ingest\`.

lh exits 0 whenever the bundle was written — a failing command is evidence, and its
exit status, signal or timeout is in the record. A missing PTY is an error, never a
silent switch to pipe.

Examples:
  lh acceptance run evidence capture --out .acceptance/ev/list -- lh agent list
  lh acceptance run evidence capture --mode pty --out .acceptance/ev/tui -- htop -n 1
  lh acceptance run evidence capture --shell --out ev/build -- 'bun run build && ls dist'`,
    )
    .action(captureAction);

  evidence
    .command('import')
    .description(
      'Build a terminal evidence bundle from output that already ran (logs, tool output, .cast) without running anything',
    )
    .requiredOption('--out <dir>', 'Bundle directory to write')
    .option('--input <file>', 'Merged output (stdout and stderr together)')
    .option('--stdout <file>', 'Captured stdout')
    .option('--stderr <file>', 'Captured stderr')
    .option('--cast <file>', 'An existing asciicast v2/v3 recording — replayable')
    .option(
      '--metadata <file>',
      'JSON facts about the run: {execution:{command,cwd,exitCode,signal,startedAt,finishedAt,environmentSummary}, source:{originalTool,originalRecordRef}}',
    )
    .option('--command <command>', 'The command that produced the output')
    .option('--cwd <dir>', 'Where it ran')
    .option('--exit-code <n>', 'Its exit status, only if actually known')
    .option('--signal <name>', 'The signal that ended it, if any')
    .option('--started-at <iso>', 'When it started')
    .option('--finished-at <iso>', 'When it finished')
    .option('--tool <name>', 'The tool that ran it (e.g. Bash)')
    .option('--record-ref <ref>', 'A reference to the original record (tool call id, log path)')
    .option(
      '--source <kind>',
      'imported (real output) | authored (an example; never counts as execution)',
      'imported',
    )
    .option(
      '--max-bytes <n>',
      'Bytes kept per input; the middle of longer input is dropped and recorded',
    )
    .option(
      '--redact <pattern>',
      'Extra text or /regex/ to mask before writing (repeatable)',
      collect,
    )
    .option('--force', 'Replace an existing bundle in --out')
    .option('--json [fields]', 'Print the record as JSON instead of a summary')
    .addHelpText(
      'after',
      `
Unknown facts stay unknown: no exit status is inferred from output that looks successful,
and text without a recording never becomes a replay. Facts a recording carries (its
command, exit event, start time) are used and noted.

Example:
  lh acceptance run evidence import --out ev/migrate --input migrate.log \\
    --command 'bun run db:migrate' --exit-code 0 --tool Bash`,
    )
    .action(importAction);
}
