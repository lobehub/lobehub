import type {
  VerifyTerminalArtifact,
  VerifyTerminalCaptureMode,
  VerifyTerminalEvidenceMetadata,
  VerifyTerminalOutcome,
  VerifyTerminalSourceKind,
  VerifyTerminalTruncation,
} from '@lobechat/types';

/**
 * Terminal evidence: one command execution, shared by the CLI that captures it,
 * the server that stores and gates it, and the page that shows it.
 *
 * The evidence row's payload is the readable text fallback
 * ({@link formatTerminalTranscript}); `metadata.terminal` carries the
 * execution facts and the artifact files. Every reader parses that metadata
 * through {@link parseTerminalEvidenceMetadata}, so the three can never
 * disagree on what a valid record is.
 */

export const TERMINAL_EVIDENCE_VERSION = 1;

export const TERMINAL_ARTIFACT_KEYS = ['stdout', 'stderr', 'output', 'cast'] as const;
export type TerminalArtifactKey = (typeof TERMINAL_ARTIFACT_KEYS)[number];

const SOURCE_KINDS = new Set<VerifyTerminalSourceKind>(['authored', 'captured', 'imported']);
const MODES = new Set<VerifyTerminalCaptureMode>(['import', 'pipe', 'pty']);
const LAYOUTS = new Set<VerifyTerminalEvidenceMetadata['capture']['streamLayout']>([
  'merged',
  'separate',
  'unknown',
]);
const TIMINGS = new Set<VerifyTerminalEvidenceMetadata['capture']['timing']>([
  'recorded',
  'unavailable',
]);
const OUTCOMES = new Set<VerifyTerminalOutcome>([
  'capture_failed',
  'exited',
  'interrupted',
  'signaled',
  'spawn_failed',
  'timed_out',
  'unknown',
]);
const TRUNCATED_STREAMS = new Set<VerifyTerminalTruncation['stream']>([
  'cast',
  'output',
  'stderr',
  'stdout',
]);

/** Bounds on the record itself — it lives in a jsonb column and every page load reads it. */
const MAX_TEXT = 8192;
const MAX_LIST = 64;
const MAX_ENV_ENTRIES = 32;

type Result = { error: string; ok: false } | { metadata: VerifyTerminalEvidenceMetadata; ok: true };

class InvalidMetadata extends Error {}

const fail = (message: string): never => {
  throw new InvalidMetadata(message);
};

const record = (value: unknown, path: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${path} must be an object`);

const nullableString = (value: unknown, path: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(`${path} must be a string or null`);
  if (value.length > MAX_TEXT) return fail(`${path} exceeds ${MAX_TEXT} characters`);
  return value;
};

const nullableInt = (value: unknown, path: string): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value))
    return fail(`${path} must be an integer or null`);
  return value;
};

const nullableIso = (value: unknown, path: string): string | null => {
  const text = nullableString(value, path);
  if (text !== null && Number.isNaN(Date.parse(text)))
    return fail(`${path} must be an ISO 8601 timestamp`);
  return text;
};

const oneOf = <T extends string>(value: unknown, allowed: ReadonlySet<T>, path: string): T =>
  typeof value === 'string' && allowed.has(value as T)
    ? (value as T)
    : fail(`${path} must be one of ${[...allowed].join(', ')}`);

const stringList = (value: unknown, path: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST) return fail(`${path} must be a short list`);
  return value.map(
    (item, i) => nullableString(item, `${path}[${i}]`) ?? fail(`${path}[${i}] is empty`),
  );
};

const artifact = (value: unknown, path: string): VerifyTerminalArtifact | null => {
  if (value === undefined || value === null) return null;
  const raw = record(value, path);
  const sha256 = nullableString(raw.sha256, `${path}.sha256`);
  if (!sha256 || !/^[\da-f]{64}$/.test(sha256)) fail(`${path}.sha256 must be a hex SHA-256`);
  const size = nullableInt(raw.size, `${path}.size`);
  if (size === null || size < 0) fail(`${path}.size must be a non-negative integer`);
  const fileId = nullableString(raw.fileId, `${path}.fileId`);
  const filePath = nullableString(raw.path, `${path}.path`);
  // Only a bundle-relative name may travel: an absolute local path is not
  // something any other machine can open, and it leaks the author's layout.
  if (filePath && (/^(?:[/\\]|[a-z]:)/i.test(filePath) || filePath.split(/[/\\]/).includes('..')))
    fail(`${path}.path must be relative to the bundle`);
  return {
    ...(fileId ? { fileId } : {}),
    ...(filePath ? { path: filePath } : {}),
    sha256: sha256!,
    size: size!,
  };
};

const truncation = (value: unknown, path: string): VerifyTerminalTruncation[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST) return fail(`${path} must be a short list`);
  return value.map((item, i) => {
    const raw = record(item, `${path}[${i}]`);
    const kept = nullableInt(raw.keptBytes, `${path}[${i}].keptBytes`);
    const dropped = nullableInt(raw.droppedBytes, `${path}[${i}].droppedBytes`);
    if (kept === null || dropped === null || kept < 0 || dropped < 0)
      fail(`${path}[${i}] needs non-negative keptBytes and droppedBytes`);
    return {
      droppedBytes: dropped!,
      keptBytes: kept!,
      stream: oneOf(raw.stream, TRUNCATED_STREAMS, `${path}[${i}].stream`),
    };
  });
};

const terminalSize = (value: unknown, path: string) => {
  if (value === undefined || value === null) return null;
  const raw = record(value, path);
  const cols = nullableInt(raw.cols, `${path}.cols`);
  const rows = nullableInt(raw.rows, `${path}.rows`);
  if (!cols || !rows || cols < 1 || rows < 1 || cols > 1000 || rows > 500)
    fail(`${path} must have cols 1-1000 and rows 1-500`);
  return { cols: cols!, rows: rows!, type: nullableString(raw.type, `${path}.type`) };
};

const environment = (value: unknown, path: string): Record<string, string> => {
  if (value === undefined || value === null) return {};
  const raw = record(value, path);
  const entries = Object.entries(raw);
  if (entries.length > MAX_ENV_ENTRIES) fail(`${path} has more than ${MAX_ENV_ENTRIES} entries`);
  return Object.fromEntries(
    entries.map(([key, v]) => [key, nullableString(v, `${path}.${key}`) ?? '']),
  );
};

/**
 * Validate a terminal evidence record. Strict on purpose: the server rejects
 * an upload this refuses, so a malformed record surfaces at upload time with a
 * path to the bad field, not as a blank card on the acceptance page.
 */
export const parseTerminalEvidenceMetadata = (value: unknown): Result => {
  try {
    const raw = record(value, 'terminal');
    if (raw.version !== TERMINAL_EVIDENCE_VERSION)
      fail(`terminal.version must be ${TERMINAL_EVIDENCE_VERSION}`);

    const source = record(raw.source, 'terminal.source');
    const execution = record(raw.execution, 'terminal.execution');
    const capture = record(raw.capture, 'terminal.capture');
    const processing = record(raw.processing ?? {}, 'terminal.processing');
    const artifacts = record(raw.artifacts ?? {}, 'terminal.artifacts');

    const parsedArtifacts = Object.fromEntries(
      TERMINAL_ARTIFACT_KEYS.map((key) => [
        key,
        artifact(artifacts[key], `terminal.artifacts.${key}`),
      ]),
    ) as VerifyTerminalEvidenceMetadata['artifacts'];

    const timing = oneOf(capture.timing, TIMINGS, 'terminal.capture.timing');
    // Replay is offered only for real recorded timing, and real timing only
    // exists as a recording. A claim of one without the other is refused.
    if ((timing === 'recorded') !== Boolean(parsedArtifacts.cast))
      fail('terminal.capture.timing is "recorded" exactly when artifacts.cast exists');

    const capturer =
      capture.capturer === undefined || capture.capturer === null
        ? null
        : (() => {
            const c = record(capture.capturer, 'terminal.capture.capturer');
            const name = nullableString(c.name, 'terminal.capture.capturer.name');
            if (!name) fail('terminal.capture.capturer.name is required');
            return {
              name: name!,
              version: nullableString(c.version, 'terminal.capture.capturer.version'),
            };
          })();

    const durationMs = nullableInt(execution.durationMs, 'terminal.execution.durationMs');
    if (durationMs !== null && durationMs < 0) fail('terminal.execution.durationMs must be >= 0');

    const metadata: VerifyTerminalEvidenceMetadata = {
      artifacts: parsedArtifacts,
      capture: {
        capturer,
        mode: oneOf(capture.mode, MODES, 'terminal.capture.mode'),
        streamLayout: oneOf(capture.streamLayout, LAYOUTS, 'terminal.capture.streamLayout'),
        terminal: terminalSize(capture.terminal, 'terminal.capture.terminal'),
        timing,
      },
      execution: {
        command: nullableString(execution.command, 'terminal.execution.command'),
        cwd: nullableString(execution.cwd, 'terminal.execution.cwd'),
        durationMs,
        environmentSummary: environment(
          execution.environmentSummary,
          'terminal.execution.environmentSummary',
        ),
        error: nullableString(execution.error, 'terminal.execution.error'),
        exitCode: nullableInt(execution.exitCode, 'terminal.execution.exitCode'),
        finishedAt: nullableIso(execution.finishedAt, 'terminal.execution.finishedAt'),
        outcome: oneOf(execution.outcome, OUTCOMES, 'terminal.execution.outcome'),
        signal: nullableString(execution.signal, 'terminal.execution.signal'),
        startedAt: nullableIso(execution.startedAt, 'terminal.execution.startedAt'),
      },
      processing: {
        missingFields: stringList(processing.missingFields, 'terminal.processing.missingFields'),
        notes: stringList(processing.notes, 'terminal.processing.notes'),
        redactions: (() => {
          const list = processing.redactions ?? [];
          if (!Array.isArray(list) || list.length > MAX_LIST)
            fail('terminal.processing.redactions must be a short list');
          return (list as unknown[]).map((item, i) => {
            const r = record(item, `terminal.processing.redactions[${i}]`);
            const rule = nullableString(r.rule, `terminal.processing.redactions[${i}].rule`);
            const count = nullableInt(r.count, `terminal.processing.redactions[${i}].count`);
            if (!rule || count === null || count < 0)
              fail(`terminal.processing.redactions[${i}] needs a rule and a count`);
            return { count: count!, rule: rule! };
          });
        })(),
        truncation: truncation(processing.truncation, 'terminal.processing.truncation'),
      },
      source: {
        kind: oneOf(source.kind, SOURCE_KINDS, 'terminal.source.kind'),
        originalRecordRef: nullableString(
          source.originalRecordRef,
          'terminal.source.originalRecordRef',
        ),
        originalTool: nullableString(source.originalTool, 'terminal.source.originalTool'),
      },
      version: TERMINAL_EVIDENCE_VERSION,
    };

    // A captured run comes from the capturer itself; it cannot be "import" mode.
    if (metadata.source.kind === 'captured' && metadata.capture.mode === 'import')
      fail('terminal.source.kind "captured" needs capture.mode pipe or pty');
    if (metadata.source.kind !== 'captured' && metadata.capture.mode !== 'import')
      fail(`terminal.source.kind "${metadata.source.kind}" needs capture.mode import`);

    return { metadata, ok: true };
  } catch (error) {
    if (error instanceof InvalidMetadata) return { error: error.message, ok: false };
    throw error;
  }
};

/** The terminal record of an evidence row's metadata bag, or undefined when absent / invalid. */
export const readTerminalEvidenceMetadata = (
  metadata: unknown,
): VerifyTerminalEvidenceMetadata | undefined => {
  if (typeof metadata !== 'object' || metadata === null || !('terminal' in metadata)) return;
  const parsed = parseTerminalEvidenceMetadata((metadata as { terminal: unknown }).terminal);
  return parsed.ok ? parsed.metadata : undefined;
};

/**
 * Whether an evidence row can stand for a real command execution. Only a
 * `terminal` evidence declaring a `captured` or `imported` source qualifies;
 * legacy text has no provenance to check and an `authored` example never
 * qualifies, however it is packaged. Eligibility is not authenticity — the
 * judge still has to read the observation.
 */
export const isExecutionEvidence = (evidence: { metadata?: unknown; type: string }): boolean => {
  if (evidence.type !== 'terminal') return false;
  const terminal = readTerminalEvidenceMetadata(evidence.metadata);
  return terminal?.source.kind === 'captured' || terminal?.source.kind === 'imported';
};

// ── Terminal stream hygiene ────────────────────────────────

/**
 * Strip the escape sequences that carry strings rather than drawing: OSC
 * (hyperlinks, clipboard writes, notifications, titles), DCS, APC, PM and SOS,
 * in their 7-bit and C1 forms. Recorded output is untrusted; none of these is
 * needed to replay what the screen showed, and each is a way to make a viewer
 * write the clipboard, open a link or talk to a handler.
 *
 * Stateful across chunks: a sequence split over two recorded events is still
 * removed whole. Unterminated sequences are dropped until their terminator.
 */
export const createTerminalSanitizer = () => {
  type State = 'escape' | 'normal' | 'string' | 'string-escape';
  let state: State = 'normal';
  // Whether the open string sequence is an OSC, which BEL also terminates.
  let osc = false;

  return (chunk: string): string => {
    let out = '';
    for (const ch of chunk) {
      switch (state) {
        case 'normal': {
          if (ch === '\u001B') state = 'escape';
          else if (
            ch === '\u009D' ||
            ch === '\u0090' ||
            ch === '\u0098' ||
            ch === '\u009E' ||
            ch === '\u009F'
          ) {
            state = 'string';
            osc = ch === '\u009D';
          } else out += ch;
          break;
        }
        case 'escape': {
          if (ch === ']' || ch === 'P' || ch === 'X' || ch === '^' || ch === '_') {
            state = 'string';
            osc = ch === ']';
          } else if (ch === '\u001B') {
            // The first ESC introduced nothing; pass it through and keep waiting.
            out += '\u001B';
          } else {
            out += `\u001B${ch}`;
            state = 'normal';
          }
          break;
        }
        case 'string': {
          if (ch === '\u001B') state = 'string-escape';
          else if (ch === '\u009C' || (osc && ch === '\u0007')) state = 'normal';
          break;
        }
        case 'string-escape': {
          state = ch === '\\' ? 'normal' : ch === '\u001B' ? 'string-escape' : 'string';
          break;
        }
      }
    }
    return out;
  };
};

// CSI (with parameter and intermediate bytes), charset selection, and other
// two-byte escapes. Ranges are spelled out: intermediates are U+0020–U+002F,
// final bytes U+0040–U+007E.
const CSI_OR_ESCAPE =
  // eslint-disable-next-line no-control-regex
  /\u001B\[[\d:;<=>?]*[\u0020-\u002F]*[\u0040-\u007E]|\u009B[\d:;<=>?]*[\u0020-\u002F]*[\u0040-\u007E]|\u001B[()*+][\dA-Z]|\u001B[\u0020-\u002F]*[\w:;<=>?@\\^`{|}~]/gi;
// eslint-disable-next-line no-control-regex
const OTHER_CONTROL = /[\u0000-\u0008\v\f\u000E-\u001A\u001C-\u001F\u007F]/g;

/**
 * Plain text of a terminal stream for reading, searching and AI review.
 * Carriage-return overwrites keep only the last write of each line — what a
 * progress bar left on screen — which approximates the screen, not replaces it.
 */
export const terminalTextFromStream = (stream: string): string => {
  const text = createTerminalSanitizer()(stream)
    .replaceAll(CSI_OR_ESCAPE, '')
    .replaceAll('\u001B', '')
    .replaceAll('\r\n', '\n');
  return text
    .split('\n')
    .map((line) => {
      const segments = line.split('\r');
      // A trailing \r just returns the carriage; the line already written stays.
      while (segments.length > 1 && segments.at(-1) === '') segments.pop();
      return segments.at(-1)!.replaceAll(OTHER_CONTROL, '');
    })
    .join('\n');
};

// ── Text fallback ──────────────────────────────────────────

const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** One-line outcome, e.g. `exit 1`, `killed by SIGTERM (timeout)`, `exit status unknown`. */
export const describeTerminalOutcome = (execution: VerifyTerminalEvidenceMetadata['execution']) => {
  switch (execution.outcome) {
    case 'exited': {
      return `exit ${execution.exitCode ?? '?'}`;
    }
    case 'signaled': {
      return `killed by ${execution.signal ?? 'a signal'}`;
    }
    case 'timed_out': {
      return `timed out${execution.signal ? `, killed by ${execution.signal}` : ''}`;
    }
    case 'interrupted': {
      return `interrupted${execution.signal ? ` (${execution.signal})` : ''}`;
    }
    case 'spawn_failed': {
      return `failed to start${execution.error ? `: ${execution.error}` : ''}`;
    }
    case 'capture_failed': {
      return `capture failed${execution.error ? `: ${execution.error}` : ''}`;
    }
    default: {
      return execution.exitCode === null ? 'exit status unknown' : `exit ${execution.exitCode}`;
    }
  }
};

/**
 * The evidence payload: everything a reader without a player — the judge, an
 * export, an old client — needs to review the execution, as plain text.
 * Header lines are facts from the record; the sections are the observation
 * verbatim. No interpretation is added: the reasoning is its own evidence.
 */
export const formatTerminalTranscript = (
  metadata: VerifyTerminalEvidenceMetadata,
  streams: { output?: string | null; stderr?: string | null; stdout?: string | null },
): string => {
  const { capture, execution, processing, source } = metadata;
  const lines: string[] = [
    `$ ${execution.command ?? '(command not recorded)'}`,
    `# cwd: ${execution.cwd ?? 'unknown'}`,
    `# source: ${source.kind}${source.originalTool ? ` from ${source.originalTool}` : ''}${
      source.originalRecordRef ? ` (${source.originalRecordRef})` : ''
    } · mode: ${capture.mode} · ${capture.timing === 'recorded' ? 'recorded timing' : 'no timing'}`,
  ];
  const when = [
    execution.startedAt && `started ${execution.startedAt}`,
    execution.durationMs !== null && `${(execution.durationMs / 1000).toFixed(2)}s`,
  ].filter(Boolean);
  lines.push(
    `# result: ${describeTerminalOutcome(execution)}${when.length ? ` · ${when.join(' · ')}` : ''}`,
  );
  const env = Object.entries(execution.environmentSummary);
  if (env.length) lines.push(`# env: ${env.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (processing.redactions.length)
    lines.push(
      `# redacted: ${processing.redactions.map((r) => `${r.rule} ×${r.count}`).join(', ')}`,
    );
  for (const t of processing.truncation)
    lines.push(
      `# truncated: ${t.stream} kept ${formatBytes(t.keptBytes)}, dropped ${formatBytes(t.droppedBytes)}`,
    );
  if (processing.missingFields.length)
    lines.push(`# unknown: ${processing.missingFields.join(', ')}`);
  for (const note of processing.notes) lines.push(`# note: ${note}`);

  const section = (name: string, raw: string | null | undefined) => {
    if (raw === undefined || raw === null) return;
    // Plain text for readers without a terminal; the artifacts keep the bytes.
    const body = terminalTextFromStream(raw);
    lines.push('', `--- ${name}${body.length === 0 ? ' (empty)' : ''} ---`);
    if (body.length > 0) lines.push(body.endsWith('\n') ? body.slice(0, -1) : body);
  };
  if (capture.streamLayout === 'separate') {
    section('stdout', streams.stdout ?? '');
    section('stderr', streams.stderr ?? '');
  } else section('output', streams.output ?? streams.stdout ?? '');

  return `${lines.join('\n')}\n`;
};
