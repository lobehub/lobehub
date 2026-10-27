import type { VerifyTerminalEvidenceMetadata } from '@lobechat/types';
import { formatDuration } from '@lobechat/utils/timing';
import {
  readTerminalEvidenceMetadata,
  TERMINAL_ARTIFACT_KEYS,
  type TerminalArtifactKey,
} from '@lobechat/utils/verify/terminalEvidence';

import type { AsciicastLoadError } from './useAsciicast';

interface TerminalReplayErrorPresentation {
  details?: string;
  summaryKey:
    | 'report.terminal.player.failed'
    | 'report.terminal.player.tooLarge'
    | 'report.terminal.player.unplayable';
}

/** Parser diagnostics belong in the disclosure, never in the readable summary. */
export const terminalReplayError = (
  error: AsciicastLoadError | null,
): TerminalReplayErrorPresentation => {
  if (error?.kind === 'invalid')
    return { details: error.message, summaryKey: 'report.terminal.player.unplayable' };
  return {
    summaryKey:
      error?.kind === 'tooLarge'
        ? 'report.terminal.player.tooLarge'
        : 'report.terminal.player.failed',
  };
};

/**
 * Pure decisions behind the terminal evidence card: which files back which
 * view, how an outcome reads, and how a search filters the output. Kept out of
 * the components so every branch is unit-tested without rendering.
 */

/** One artifact as the bundle hands it to the page: a signed URL in place of the file id. */
export interface TerminalArtifactLink {
  fileUrl: string | null;
  sha256: string;
  size: number;
}

export type TerminalArtifactLinks = Partial<Record<TerminalArtifactKey, TerminalArtifactLink>>;

/**
 * What the card reads off an evidence row. Structural on purpose: the
 * acceptance bundle and the report bundle type their rows differently, and the
 * artifact links arrive untyped on the latter, so they are validated here.
 */
export interface TerminalEvidenceInput {
  content?: string | null;
  description?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  id: string;
  metadata?: unknown;
  terminalArtifacts?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The artifact links of a row, dropping anything malformed instead of trusting the wire. */
export const readTerminalArtifactLinks = (value: unknown): TerminalArtifactLinks => {
  if (!isRecord(value)) return {};
  const links: TerminalArtifactLinks = {};
  for (const key of TERMINAL_ARTIFACT_KEYS) {
    const raw = value[key];
    if (!isRecord(raw)) continue;
    const { fileUrl, sha256, size } = raw;
    if (typeof sha256 !== 'string' || typeof size !== 'number') continue;
    links[key] = {
      fileUrl: typeof fileUrl === 'string' && fileUrl.length > 0 ? fileUrl : null,
      sha256,
      size,
    };
  }
  return links;
};

// ── Outcome ─────────────────────────────────────────────────

export type TerminalOutcomeTone = 'error' | 'neutral' | 'success' | 'warning';

/**
 * Color for the outcome badge. Only a recorded exit 0 is success; anything the
 * record does not know stays neutral rather than borrowing a tone it has not
 * earned. An interrupted run or a failed capture says the observation is
 * incomplete, not that the command failed — warning, not error.
 */
export const terminalOutcomeTone = (
  execution: Pick<VerifyTerminalEvidenceMetadata['execution'], 'exitCode' | 'outcome'>,
): TerminalOutcomeTone => {
  switch (execution.outcome) {
    case 'signaled':
    case 'spawn_failed':
    case 'timed_out': {
      return 'error';
    }
    case 'capture_failed':
    case 'interrupted': {
      return 'warning';
    }
    default: {
      if (execution.exitCode === null) return 'neutral';
      return execution.exitCode === 0 ? 'success' : 'error';
    }
  }
};

/** i18n key + values for the outcome badge, e.g. `exit 1`, `killed by SIGTERM`. */
export const terminalOutcomeLabel = (
  execution: Pick<VerifyTerminalEvidenceMetadata['execution'], 'exitCode' | 'outcome' | 'signal'>,
): { key: string; values?: Record<string, string | number> } => {
  const signal = execution.signal ?? undefined;
  switch (execution.outcome) {
    case 'signaled': {
      return signal
        ? { key: 'report.terminal.outcome.signaled', values: { signal } }
        : { key: 'report.terminal.outcome.signaledUnknown' };
    }
    case 'timed_out': {
      return { key: 'report.terminal.outcome.timedOut' };
    }
    case 'interrupted': {
      return { key: 'report.terminal.outcome.interrupted' };
    }
    case 'spawn_failed': {
      return { key: 'report.terminal.outcome.spawnFailed' };
    }
    case 'capture_failed': {
      return { key: 'report.terminal.outcome.captureFailed' };
    }
    default: {
      return execution.exitCode === null
        ? { key: 'report.terminal.outcome.unknown' }
        : { key: 'report.terminal.outcome.exit', values: { code: execution.exitCode } };
    }
  }
};

/** `850 ms` · `1.24 s` · `12.3 s` · `3m 7s` — precise where a command's duration usually lives. */
export const formatTerminalDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return formatDuration(ms);
};

// ── Views ───────────────────────────────────────────────────

/**
 * Where a view's text comes from.
 * - url: an uploaded artifact file, decoded for display
 * - cast: no plain-text artifact exists, so the text is read out of the recording
 * - inline: the row's inline payload
 * - empty: the record says the stream is empty, so there is nothing to fetch
 */
export type TerminalTextSource =
  | { kind: 'cast'; url: string }
  | { kind: 'empty' }
  | { kind: 'inline'; text: string }
  | { kind: 'url'; url: string };

export type TerminalTextViewKey = 'output' | 'stderr' | 'stdout' | 'transcript';

export interface TerminalTextView {
  key: TerminalTextViewKey;
  /** Strip escape sequences before display — terminal streams, never the transcript. */
  plain: boolean;
  source: TerminalTextSource;
}

export interface TerminalViewPlan {
  /** The view the body opens on. */
  defaultView: TerminalTextViewKey | 'replay';
  /** The recording to replay — only when the record claims real timing AND the file resolved. */
  replayUrl?: string;
  terminal?: VerifyTerminalEvidenceMetadata;
  /** Text views in display order; the transcript, when there is one, is always last. */
  views: TerminalTextView[];
}

/**
 * One stream's source. The capturer writes a file for every non-empty stream
 * and none for an empty one, so a stream the record does not list — or lists
 * with size 0 — is honestly empty. One it lists with bytes but whose URL did
 * not resolve is unavailable: returning `undefined` makes the caller fall back
 * to the transcript instead of claiming "no output".
 */
const streamSource = (
  key: TerminalArtifactKey,
  terminal: VerifyTerminalEvidenceMetadata,
  links: TerminalArtifactLinks,
): TerminalTextSource | undefined => {
  const url = links[key]?.fileUrl;
  if (url) return { kind: 'url', url };
  const artifact = terminal.artifacts[key];
  if (!artifact || artifact.size === 0) return { kind: 'empty' };
  return undefined;
};

const transcriptSource = (input: TerminalEvidenceInput): TerminalTextSource | undefined => {
  if (input.content) return { kind: 'inline', text: input.content };
  if (input.fileUrl) return { kind: 'url', url: input.fileUrl };
  return undefined;
};

/**
 * Decide the card's body: stdout / stderr apart for a pipe capture, one merged
 * output otherwise, the recording for replay when there is one, and the row's
 * own transcript as the always-reachable text path. Without a readable record
 * the transcript is the whole body.
 */
export const resolveTerminalViews = (input: TerminalEvidenceInput): TerminalViewPlan => {
  const terminal = readTerminalEvidenceMetadata(input.metadata);
  const transcript = transcriptSource(input);
  const transcriptView: TerminalTextView[] = transcript
    ? [{ key: 'transcript', plain: false, source: transcript }]
    : [];

  if (!terminal) return { defaultView: 'transcript', views: transcriptView };

  const links = readTerminalArtifactLinks(input.terminalArtifacts);
  const replayUrl =
    terminal.capture.timing === 'recorded' ? (links.cast?.fileUrl ?? undefined) : undefined;

  const streams: TerminalTextView[] = [];
  if (terminal.capture.streamLayout === 'separate') {
    const stdout = streamSource('stdout', terminal, links);
    const stderr = streamSource('stderr', terminal, links);
    // Both or neither: a lone stdout tab next to a stream we cannot load would
    // read as "stderr was empty" when it was only unavailable.
    if (stdout && stderr)
      streams.push(
        { key: 'stdout', plain: true, source: stdout },
        { key: 'stderr', plain: true, source: stderr },
      );
  } else {
    const output = links.output?.fileUrl
      ? ({ kind: 'url', url: links.output.fileUrl } as const)
      : links.cast?.fileUrl
        ? ({ kind: 'cast', url: links.cast.fileUrl } as const)
        : streamSource('output', terminal, links);
    // An empty `output` with an unresolved recording is unknown, not empty.
    const castPending = Boolean(terminal.artifacts.cast) && !links.cast?.fileUrl;
    if (output && !(output.kind === 'empty' && castPending))
      streams.push({ key: 'output', plain: true, source: output });
  }

  const views = [...streams, ...transcriptView];
  // Open on the stream that has something to say: stderr when stdout is empty.
  const firstWithText = streams.find((view) => view.source.kind !== 'empty');
  const defaultView = firstWithText?.key ?? views[0]?.key ?? (replayUrl ? 'replay' : 'transcript');
  return { defaultView, replayUrl, terminal, views };
};

/**
 * The collapsed row's label: the command itself when recorded — it is the one
 * fact a reader scans for — else the authored description, else the first
 * line of the transcript.
 */
export const terminalFoldTitle = (
  terminal: VerifyTerminalEvidenceMetadata | undefined,
  input: Pick<TerminalEvidenceInput, 'content' | 'description' | 'fileName'>,
): string => {
  const command = terminal?.execution.command?.trim();
  if (command) return command;
  const label = input.description?.trim() || input.fileName?.trim();
  if (label) return label;
  const firstLine = input.content
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.replace(/^\$\s+/, '') ?? '';
};

// ── Search ──────────────────────────────────────────────────

export interface TerminalLineMatch {
  /** 1-based line number in the full output. */
  line: number;
  /** [start, end) offsets of each match within the line. */
  ranges: [number, number][];
  text: string;
}

export interface TerminalSearchResult {
  /** Matching lines, capped at `limit`; `matchCount` still counts them all. */
  lines: TerminalLineMatch[];
  matchCount: number;
  matchedLineCount: number;
}

/**
 * Case-insensitive plain-substring search, line by line. Plain text, not a
 * regex: output is full of characters a reader types literally (`[`, `.`, `*`).
 */
export const searchTerminalLines = (
  text: string,
  query: string,
  limit = 2000,
): TerminalSearchResult => {
  const needle = query.toLowerCase();
  const result: TerminalSearchResult = { lines: [], matchCount: 0, matchedLineCount: 0 };
  if (!needle) return result;

  text.split('\n').forEach((line, index) => {
    const haystack = line.toLowerCase();
    const ranges: [number, number][] = [];
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      ranges.push([from, from + needle.length]);
      from = haystack.indexOf(needle, from + needle.length);
    }
    if (ranges.length === 0) return;
    result.matchCount += ranges.length;
    result.matchedLineCount += 1;
    if (result.lines.length < limit) result.lines.push({ line: index + 1, ranges, text: line });
  });
  return result;
};

/** Number of display lines; a trailing newline ends the last line rather than opening one. */
export const splitTerminalLines = (text: string): string[] => {
  const lines = text.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
};
