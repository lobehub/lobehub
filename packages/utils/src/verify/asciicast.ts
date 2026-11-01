/**
 * asciicast reading and writing for terminal evidence.
 *
 * The capturer writes v3 (https://docs.asciinema.org/manual/asciicast/v3/):
 * relative event intervals and an `x` exit event. The reader also accepts v2,
 * the format asciinema 2.x recorded for years, so an existing real recording can
 * be imported as-is. Both normalize to absolute event times.
 *
 * A recording is untrusted input — it can be hand-edited, truncated or hostile —
 * so every limit below is enforced while reading, before anything renders it.
 */

export type AsciicastEventCode = 'i' | 'm' | 'o' | 'r' | 'x';

export interface AsciicastEvent {
  code: AsciicastEventCode;
  data: string;
  /** Seconds since the recording started. */
  t: number;
}

export interface Asciicast {
  cols: number;
  command: string | null;
  /** Seconds from start to the last event. */
  duration: number;
  events: AsciicastEvent[];
  /** Exit status from a v3 `x` event, when the recording has one. */
  exitStatus: number | null;
  rows: number;
  termType: string | null;
  /** Unix seconds the recording started at, when recorded. */
  timestamp: number | null;
  version: 2 | 3;
}

export interface AsciicastLimits {
  maxBytes: number;
  maxCols: number;
  maxDurationSeconds: number;
  maxEventBytes: number;
  maxEvents: number;
  maxRows: number;
}

export const ASCIICAST_LIMITS: AsciicastLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxCols: 1000,
  maxDurationSeconds: 6 * 60 * 60,
  maxEventBytes: 1024 * 1024,
  maxEvents: 200_000,
  maxRows: 500,
};

export class AsciicastError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'AsciicastError';
  }
}

const EVENT_CODES = new Set<string>(['i', 'm', 'o', 'r', 'x']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** `"120x40"` → `{ cols: 120, rows: 40 }`; anything else is not a resize. */
export const parseResize = (data: string): { cols: number; rows: number } | undefined => {
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(data);
  if (!match) return undefined;
  const cols = Number(match[1]);
  const rows = Number(match[2]);
  return cols > 0 && rows > 0 ? { cols, rows } : undefined;
};

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/**
 * Parse and validate a v2 or v3 recording. Throws {@link AsciicastError} naming
 * the offending line — the caller decides whether that means "reject the
 * import" or "fall back to the text view".
 */
export const parseAsciicast = (
  text: string,
  limits: AsciicastLimits = ASCIICAST_LIMITS,
): Asciicast => {
  if (text.length > limits.maxBytes || utf8Length(text) > limits.maxBytes)
    throw new AsciicastError(`recording exceeds ${limits.maxBytes} bytes`);

  const lines = text.split('\n');
  let index = 0;
  // v3 allows comment and blank lines anywhere; v2 tolerates trailing blanks.
  const skip = () => {
    while (index < lines.length && (/^\s*$/.test(lines[index]) || lines[index].startsWith('#')))
      index += 1;
  };

  skip();
  if (index >= lines.length) throw new AsciicastError('recording is empty');

  let header: unknown;
  try {
    header = JSON.parse(lines[index]);
  } catch {
    throw new AsciicastError('header is not valid JSON', index + 1);
  }
  if (!isRecord(header)) throw new AsciicastError('header must be a JSON object', index + 1);

  const version = header.version;
  if (version !== 2 && version !== 3)
    throw new AsciicastError(`unsupported asciicast version ${String(version)}`, index + 1);

  const term = version === 3 ? (isRecord(header.term) ? header.term : undefined) : header;
  const cols = positiveInt(version === 3 ? term?.cols : header.width);
  const rows = positiveInt(version === 3 ? term?.rows : header.height);
  if (!cols || !rows)
    throw new AsciicastError('header must declare a positive terminal size', index + 1);
  if (cols > limits.maxCols || rows > limits.maxRows)
    throw new AsciicastError(
      `terminal size ${cols}x${rows} exceeds ${limits.maxCols}x${limits.maxRows}`,
      index + 1,
    );

  const termType =
    version === 3
      ? stringOrNull(term?.type)
      : stringOrNull(isRecord(header.env) ? header.env.TERM : undefined);
  const timestamp =
    typeof header.timestamp === 'number' && Number.isFinite(header.timestamp)
      ? header.timestamp
      : null;

  const events: AsciicastEvent[] = [];
  let clock = 0;
  let exitStatus: number | null = null;
  index += 1;

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*$/.test(line) || line.startsWith('#')) continue;
    const lineNo = index + 1;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new AsciicastError('event is not valid JSON', lineNo);
    }
    if (!Array.isArray(raw) || raw.length < 3)
      throw new AsciicastError('event must be [time, code, data]', lineNo);

    const [time, code, data] = raw;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0)
      throw new AsciicastError('event time must be a non-negative number', lineNo);
    if (typeof code !== 'string' || !EVENT_CODES.has(code))
      throw new AsciicastError(`unknown event code ${JSON.stringify(code)}`, lineNo);
    if (typeof data !== 'string') throw new AsciicastError('event data must be a string', lineNo);
    if (utf8Length(data) > limits.maxEventBytes)
      throw new AsciicastError(`event exceeds ${limits.maxEventBytes} bytes`, lineNo);

    if (version === 3) clock += time;
    else {
      if (time < clock) throw new AsciicastError('event times must not go backwards', lineNo);
      clock = time;
    }
    if (clock > limits.maxDurationSeconds)
      throw new AsciicastError(`recording runs past ${limits.maxDurationSeconds} seconds`, lineNo);

    if (code === 'r') {
      const size = parseResize(data);
      if (!size) throw new AsciicastError('resize data must be COLSxROWS', lineNo);
      if (size.cols > limits.maxCols || size.rows > limits.maxRows)
        throw new AsciicastError(
          `resize ${data} exceeds ${limits.maxCols}x${limits.maxRows}`,
          lineNo,
        );
    }
    if (code === 'x') {
      const status = Number(data);
      exitStatus = Number.isInteger(status) ? status : null;
    }

    events.push({ code: code as AsciicastEventCode, data, t: clock });
    if (events.length > limits.maxEvents)
      throw new AsciicastError(`recording has more than ${limits.maxEvents} events`, lineNo);
  }

  return {
    cols,
    command: stringOrNull(header.command),
    duration: clock,
    events,
    exitStatus,
    rows,
    termType,
    timestamp,
    version,
  };
};

export interface AsciicastV3Header {
  cols: number;
  command?: string | null;
  rows: number;
  termType?: string | null;
  /** Unix seconds. */
  timestamp?: number | null;
  title?: string | null;
}

/** Microsecond precision is what asciinema itself writes. */
const interval = (seconds: number) => Math.round(Math.max(0, seconds) * 1e6) / 1e6;

/** Serialize events with absolute times as an asciicast v3 document. */
export const encodeAsciicastV3 = (header: AsciicastV3Header, events: AsciicastEvent[]): string => {
  const head: Record<string, unknown> = {
    term: {
      cols: header.cols,
      rows: header.rows,
      ...(header.termType ? { type: header.termType } : {}),
    },
    version: 3,
  };
  if (typeof header.timestamp === 'number') head.timestamp = Math.floor(header.timestamp);
  if (header.command) head.command = header.command;
  if (header.title) head.title = header.title;

  const out = [JSON.stringify(head)];
  let previous = 0;
  for (const event of events) {
    out.push(JSON.stringify([interval(event.t - previous), event.code, event.data]));
    previous = Math.max(previous, event.t);
  }
  return `${out.join('\n')}\n`;
};
