import path from 'node:path';

import type { App, WebContents } from 'electron';

import type { LogLevel } from './layout';
import { splitConsoleTag } from './record';
import { writeStructuredLog } from './sink';

const CONSOLE_METHODS = {
  debug: 'debug',
  error: 'error',
  info: 'info',
  log: 'info',
  trace: 'debug',
  warn: 'warn',
} as const satisfies Partial<Record<keyof Console, LogLevel>>;

type ConsoleMethod = keyof typeof CONSOLE_METHODS;

/** The methods replaced by `captureMainConsole`; empty until it runs. */
const originals: Partial<Pick<Console, ConsoleMethod>> = {};

const callRaw =
  (method: ConsoleMethod) =>
  (...args: unknown[]) =>
    (originals[method] ?? console[method])(...args);

/**
 * Console methods that bypass the mirror. `createLogger` prints through these
 * so a line it already recorded is not recorded a second time.
 */
export const rawConsole: Pick<Console, ConsoleMethod> = {
  debug: callRaw('debug'),
  error: callRaw('error'),
  info: callRaw('info'),
  log: callRaw('log'),
  trace: callRaw('trace'),
  warn: callRaw('warn'),
};

/** Mirrors the main process's direct `console.*` calls into `main.jsonl`. */
export const captureMainConsole = () => {
  if (Object.keys(originals).length > 0) return;
  for (const [method, level] of Object.entries(CONSOLE_METHODS) as [ConsoleMethod, LogLevel][]) {
    const original = console[method].bind(console);
    originals[method] = original;
    console[method] = (...args: unknown[]) => {
      original(...args);
      const [first, ...rest] = args;
      const { message, ns } =
        typeof first === 'string' ? splitConsoleTag(first) : { message: first, ns: undefined };
      writeStructuredLog({
        args: rest,
        level,
        message,
        ns: ns ?? 'console',
        process: 'main',
      });
    };
  }
};

const RENDERER_LEVELS: Record<string, LogLevel> = {
  debug: 'debug',
  error: 'error',
  info: 'info',
  warning: 'warn',
};

/** Keeps the path of a script URL; its query string may carry tokens. */
const describeSource = (sourceUrl: string, lineNumber: number) => {
  if (!sourceUrl) return undefined;
  try {
    const url = new URL(sourceUrl);
    return `${url.protocol === 'file:' ? path.basename(url.pathname) : url.pathname}:${lineNumber}`;
  } catch {
    return `${sourceUrl.split('?')[0]}:${lineNumber}`;
  }
};

/** The subset of Electron's `WebContentsConsoleMessageEventParams` that is recorded. */
interface ConsoleMessageDetails {
  level: string;
  lineNumber: number;
  message: string;
  sourceId: string;
}

export const recordRendererConsoleMessage = (
  windowName: string,
  { level, lineNumber, message, sourceId }: ConsoleMessageDetails,
) => {
  const { message: text, ns } = splitConsoleTag(message);
  writeStructuredLog({
    level: RENDERER_LEVELS[level] ?? 'info',
    message: text,
    ns: ns ? `renderer:${windowName}:${ns}` : `renderer:${windowName}`,
    process: 'renderer',
    source: describeSource(sourceId, lineNumber),
  });
};

/**
 * App windows only: `webview` and other guest contents render third-party
 * pages whose console output is neither ours nor safe to keep.
 */
const isAppWindow = (contents: WebContents) => contents.getType() === 'window';

let rendererCaptured = false;

/**
 * Records every app window's console into `renderer.jsonl` from the main
 * process, so the renderer needs no logging bridge and dev and packaged builds
 * capture the same lines. A renderer crash is recorded in `main.jsonl`.
 */
export const captureRendererLogs = (app: Pick<App, 'on'>) => {
  if (rendererCaptured) return;
  rendererCaptured = true;
  app.on('web-contents-created', (_event, contents) => {
    if (!isAppWindow(contents)) return;
    const windowName = `w${contents.id}`;

    contents.on('console-message', (details) => {
      recordRendererConsoleMessage(windowName, details);
    });
    contents.on('render-process-gone', (_goneEvent, details) => {
      writeStructuredLog({
        args: [details],
        level: 'error',
        message: `renderer ${windowName} gone: ${details.reason}`,
        ns: 'renderer-lifecycle',
        process: 'main',
      });
    });
  });
};
