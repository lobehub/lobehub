import { appendFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'node:util';

import debug from 'debug';

/**
 * In local development, automatically write all server output to a log file.
 *
 * Captures:
 * - process.stdout / process.stderr (Next.js request logs, etc.)
 * - console.log / console.warn / console.error / console.info
 * - debug package output
 *
 * - Controlled by `DEBUG_LOG_FILE=1` env var
 * - Only active in non-production environment
 * - Log files are split by date: `logs/2026-03-19.log`
 */

const shouldEnable = process.env.DEBUG_LOG_FILE === '1' && process.env.NODE_ENV !== 'production';

if (shouldEnable) {
  const LOG_DIR = resolve(process.cwd(), 'logs');

  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  // Use fd-based sync write to avoid re-entrance when intercepting stdout/stderr
  let currentDate = '';
  let fd: number | undefined;

  const ensureFd = () => {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (date !== currentDate) {
      currentDate = date;
      fd = openSync(resolve(LOG_DIR, `${date}.log`), 'a');
    }
    return fd!;
  };

  // Strip ANSI escape codes (colors, cursor movement, etc.)
  // eslint-disable-next-line no-control-regex, regexp/no-obscure-range
  const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  const stripAnsi = (str: string) => str.replaceAll(ANSI_RE, '');

  const appendToFile = (data: string) => {
    try {
      appendFileSync(ensureFd(), stripAnsi(data));
    } catch {
      // Silently ignore write errors to avoid breaking the server
    }
  };

  // Intercept process.stdout and process.stderr
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: any, ...rest: any[]) => {
    appendToFile(typeof chunk === 'string' ? chunk : chunk.toString());
    return (originalStdoutWrite as any)(chunk, ...rest);
  };

  process.stderr.write = (chunk: any, ...rest: any[]) => {
    appendToFile(typeof chunk === 'string' ? chunk : chunk.toString());
    return (originalStderrWrite as any)(chunk, ...rest);
  };

  // Intercept debug package output (writes to stderr, but may use custom format)
  const originalDebugLog = debug.log;

  debug.log = (...args: any[]) => {
    if (originalDebugLog) {
      originalDebugLog(...args);
    } else {
      process.stderr.write(format(...args) + '\n');
    }
  };
}
