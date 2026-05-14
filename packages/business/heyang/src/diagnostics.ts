type DiagnosticPayload = Record<string, unknown> | undefined;

const REDACTED = '[redacted]';

const isDiagnosticEnabled = () =>
  (globalThis as any).process?.env?.HEYANG_DIAGNOSTICS_ENABLED === '1';

const shouldRedactKey = (key: string) =>
  /api[-_]?key|authorization|cookie|password|secret|token|key/i.test(key);

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redact(item));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        shouldRedactKey(key) ? REDACTED : redact(item),
      ]),
    );
  }

  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...`;

  return value;
};

const writeStderr = (line: string) => {
  const stderr = (globalThis as any).process?.stderr;

  if (stderr?.write) {
    stderr.write(`${line}\n`);
  }
};

const emit = (level: 'warn', event: string, payload?: DiagnosticPayload) => {
  if (!isDiagnosticEnabled()) return;

  const safePayload = payload ? ` ${JSON.stringify(redact(payload))}` : '';
  writeStderr(`[heyang:${level}] ${event}${safePayload}`);
};

export const heyangDiagnostics = {
  warn: (event: string, payload?: DiagnosticPayload) => emit('warn', event, payload),
};
