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
const cache = new Map<string, Logger>();

/**
 * Replace the package-wide logger factory. Call this once at host startup
 * (e.g. desktop bootstrap) to route logs through electron-log + namespaced
 * debug. CLI and sandbox can leave it unset and rely on the `debug` default.
 *
 * Safe to call after `createLogger(namespace)` has already been invoked at
 * module load — the returned logger is a lazy proxy that re-resolves the
 * current factory on every method call.
 */
export const setLoggerFactory = (factory: LoggerFactory): void => {
  currentFactory = factory;
  // Invalidate cached concrete loggers so subsequent calls see the new factory.
  cache.clear();
};

const resolveLogger = (namespace: string): Logger => {
  const cached = cache.get(namespace);
  if (cached) return cached;
  const logger = currentFactory(namespace);
  cache.set(namespace, logger);
  return logger;
};

/**
 * Return a {@link Logger} bound to `namespace`. The returned object is a thin
 * proxy that dispatches each call through the **current** factory, so calling
 * {@link setLoggerFactory} after module-level `createLogger(...)` invocations
 * still takes effect.
 */
export const createLogger: LoggerFactory = (namespace) => ({
  debug: (message, ...args) => resolveLogger(namespace).debug(message, ...args),
  error: (message, ...args) => resolveLogger(namespace).error(message, ...args),
  info: (message, ...args) => resolveLogger(namespace).info(message, ...args),
  verbose: (message, ...args) => resolveLogger(namespace).verbose?.(message, ...args),
  warn: (message, ...args) => resolveLogger(namespace).warn(message, ...args),
});
