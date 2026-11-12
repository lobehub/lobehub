import { format } from 'node:util';

import type { LogLevel, LogProcess, LogRecord } from './layout';

const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 4000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
/** A larger record keeps its message and loses its `args`, so one huge payload cannot flood the file. */
export const MAX_RECORD_BYTES = 64 * 1024;

/**
 * Server ids, `op_${Date.now()}_${agentId}_${topicId}_${nanoid}` and `tpc_…`
 * (`packages/database/src/utils/idGenerator.ts`). The topic pattern also matches
 * inside an operation id, so a record that only names the operation still
 * carries its topic.
 */
const OPERATION_ID_PATTERN = /(?<![\w-])op_[\w-]+/;
const TOPIC_ID_PATTERN = /(?<![A-Za-z0-9])tpc_[A-Za-z0-9]+/;

/**
 * A secret-named key in text. Plural `tokens` is excluded so usage counters such
 * as `inputTokens: 532` stay readable; every other secret key is redacted
 * whatever its value looks like, since a password or token can be all digits.
 */
const SECRET_KEY = String.raw`[\w-]*(?:token(?!s(?![a-z]))|secret|password|passwd|authorization|api[-_]?key|apikey|credential)[\w-]*`;

const SECRET_PATTERNS: [RegExp, string][] = [
  // A cookie header carries several `name=value` pairs; drop the whole value.
  [/(\b(?:set-)?cookie["']?\s*[:=]\s*["']?)[^"'\n]+/gi, '$1[REDACTED]'],
  // `"accessToken":"…"` in stringified JSON (`JSON.stringify(headers)`).
  [new RegExp(String.raw`("${SECRET_KEY}"\s*:\s*")[^"]*`, 'gi'), '$1[REDACTED]'],
  // `password=…`, `api_key: …`, and URL query parameters such as `?access_token=…`.
  // Boolean and null literals stay readable (`tokenExpired: false`); quoted values
  // are redacted whole.
  [
    new RegExp(
      String.raw`(\b${SECRET_KEY}\s*[=:]\s*)(?!(?:true|false|null|undefined)(?![\w-]))(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s&;,"']+)`,
      'gi',
    ),
    '$1[REDACTED]',
  ],
  // URL userinfo: authenticated proxy URLs (`http://user:pass@host`) reach debug lines.
  [/(\b[a-z][\d+.a-z-]*:\/\/)[^\s/?#@]+@/gi, '$1[REDACTED]@'],
  // Short query names that commonly carry credentials (`?key=AIza…`, presigned `sig=`).
  [/([?&](?:key|sig|signature|code)=)[^&\s"']+/gi, '$1[REDACTED]'],
  [/(bearer\s+)[\w.~+/-]+=*/gi, '$1[REDACTED]'],
  // JWTs: access/refresh tokens are the most likely secret to reach a log line.
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[REDACTED_JWT]'],
  [/\bsk-[\w-]{16,}/g, '[REDACTED_KEY]'],
];
const SECRET_KEY_PATTERN = /token|secret|password|authorization|cookie|api[-_]?key/i;

export const redactSecrets = (value: string) =>
  SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );

const truncate = (value: string) =>
  value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}…[${value.length - MAX_STRING_LENGTH} more chars]`
    : value;

/** Converts one log argument into a JSON-safe, bounded, secret-redacted value. */
export const toLogValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') return truncate(redactSecrets(value));
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return '[undefined]';
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);

  const object = value as object;
  if (seen.has(object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(object) ? '[Array]' : '[Object]';
  seen.add(object);

  if (object instanceof Error) {
    const { cause, code } = object as Error & { code?: unknown };
    return {
      message: toLogValue(object.message, depth + 1, seen),
      name: object.name,
      ...(object.stack ? { stack: toLogValue(object.stack, depth + 1, seen) } : undefined),
      ...(code === undefined ? undefined : { code: toLogValue(code, depth + 1, seen) }),
      ...(cause === undefined ? undefined : { cause: toLogValue(cause, depth + 1, seen) }),
    };
  }
  if (object instanceof Date) return object.toISOString();
  if (Array.isArray(object)) {
    const items = object.slice(0, MAX_ARRAY_ITEMS).map((item) => toLogValue(item, depth + 1, seen));
    if (object.length > MAX_ARRAY_ITEMS) items.push(`[${object.length - MAX_ARRAY_ITEMS} more]`);
    return items;
  }
  if (object instanceof Map) return toLogValue(Object.fromEntries(object), depth, seen);
  if (object instanceof Set) return toLogValue([...object], depth, seen);
  if (ArrayBuffer.isView(object)) return `[${object.constructor.name} ${object.byteLength} bytes]`;

  const entries = Object.entries(object);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[key] =
      SECRET_KEY_PATTERN.test(key) && typeof item === 'string'
        ? '[REDACTED]'
        : toLogValue(item, depth + 1, seen);
  }
  if (entries.length > MAX_OBJECT_KEYS)
    result['…'] = `${entries.length - MAX_OBJECT_KEYS} more keys`;
  return result;
};

const hasFormatSpecifier = (message: string) => /%[sdifjoOc%]/.test(message);

export interface CreateLogRecordInput {
  appVersion?: string;
  args?: unknown[];
  level: LogLevel;
  message: unknown;
  now?: Date;
  ns?: string;
  pid?: number;
  process: LogProcess;
  source?: string;
}

export const createLogRecord = ({
  appVersion,
  args = [],
  level,
  message,
  now = new Date(),
  ns,
  pid = globalThis.process.pid,
  process,
  source,
}: CreateLogRecordInput): LogRecord => {
  let msg: string;
  let rest = args;
  if (typeof message === 'string' && rest.length > 0 && hasFormatSpecifier(message)) {
    // `debug`-style `logger.debug('loaded %s in %dms', a, b)`: the formatted text is
    // what a reader greps for, and its arguments are consumed by the format.
    // Sanitize first: `%O` / `%j` would otherwise print secret-named fields verbatim.
    msg = format(message, ...rest.map((arg) => toLogValue(arg)));
    rest = [];
  } else if (typeof message === 'string') {
    msg = message;
  } else {
    msg = '';
    rest = [message, ...rest];
  }
  msg = truncate(redactSecrets(msg));

  const safeArgs = rest.map((arg) => toLogValue(arg));
  const haystack = safeArgs.length > 0 ? `${msg} ${JSON.stringify(safeArgs)}` : msg;
  const operationId = OPERATION_ID_PATTERN.exec(haystack)?.[0];
  const topicId = TOPIC_ID_PATTERN.exec(haystack)?.[0];

  return {
    ...(safeArgs.length > 0 ? { args: safeArgs } : undefined),
    ...(appVersion ? { appVersion } : undefined),
    level,
    msg,
    ...(ns ? { ns } : undefined),
    ...(operationId ? { operationId } : undefined),
    pid,
    process,
    ...(source ? { source } : undefined),
    ...(topicId ? { topicId } : undefined),
    ts: now.toISOString(),
  };
};

/** Serializes a record to one JSONL line, dropping `args` when the line would exceed the cap. */
export const serializeLogRecord = (record: LogRecord): string => {
  const line = JSON.stringify(record);
  if (line.length <= MAX_RECORD_BYTES || !record.args) return `${line}\n`;
  const { args: _args, ...rest } = record;
  return `${JSON.stringify({ ...rest, args: [`[args dropped: ${line.length} chars]`] })}\n`;
};

const TAG_PATTERN = /^\[([^\]]{1,80})\]\s*/;

/** `console.info('[Menu] Opening …')` → namespace `Menu`, message `Opening …`. */
export const splitConsoleTag = (message: string): { message: string; ns?: string } => {
  const match = TAG_PATTERN.exec(message);
  return match ? { message: message.slice(match[0].length), ns: match[1] } : { message };
};
