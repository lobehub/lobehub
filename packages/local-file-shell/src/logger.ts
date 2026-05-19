import debug from 'debug';

/**
 * Minimal logger interface. Each level is variadic — the first arg is a
 * message string and the rest are formatter arguments (matches the shape
 * agreed across LobeHub packages).
 */
export interface Logger {
  debug: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  verbose?: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
}

export type LoggerFactory = (namespace: string) => Logger;

const DEFAULT_NAMESPACE_PREFIX = 'lobe-local-file-shell';

/**
 * Default logger factory backed by the `debug` package — enabled at runtime
 * via the standard `DEBUG=lobe-local-file-shell:*` env var. `error` always
 * surfaces via `console.error` so genuine failures aren't swallowed even when
 * debug logging is off.
 */
export const createDefaultLogger: LoggerFactory = (namespace) => {
  const fullNamespace = namespace.startsWith(DEFAULT_NAMESPACE_PREFIX)
    ? namespace
    : `${DEFAULT_NAMESPACE_PREFIX}:${namespace}`;
  const debugLogger = debug(fullNamespace);

  return {
    debug: (message, ...args) => debugLogger(message as string, ...args),
    error: (message, ...args) => {
      console.error(`[${fullNamespace}]`, message, ...args);
    },
    info: (message, ...args) => debugLogger(`INFO: ${message}`, ...args),
    verbose: (message, ...args) => debugLogger(`VERBOSE: ${message}`, ...args),
    warn: (message, ...args) => debugLogger(`WARN: ${message}`, ...args),
  };
};

let currentFactory: LoggerFactory = createDefaultLogger;

/**
 * Replace the package-wide logger factory. Desktop calls this once at startup
 * to route logs through electron-log + namespaced debug. CLI and sandbox can
 * leave it unset and rely on the `debug` default.
 */
export const setLoggerFactory = (factory: LoggerFactory): void => {
  currentFactory = factory;
};

export const createLogger: LoggerFactory = (namespace) => currentFactory(namespace);
