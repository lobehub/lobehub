import { createLogger } from '@/utils/logger';

const logger = createLogger('main:process-error-handlers');

/**
 * Transient Chromium network errors emitted by Electron's `net` stack
 * (`SimpleURLLoaderWrapper`). These happen during normal operation — switching
 * Wi-Fi / VPN, the machine sleeping, the network interface dropping — and are
 * NOT application bugs. Electron emits them as an `error` event on the internal
 * loader; when nothing is listening they bubble up as an `uncaughtException`
 * and pop the "A JavaScript error occurred in the main process" dialog, even
 * though the request layer already handles the failure via promise rejection.
 *
 * We swallow these specific cases so transient connectivity blips never crash
 * the main process. Everything else is re-thrown to preserve normal crash
 * visibility.
 *
 * @see https://github.com/electron/electron/issues/24948
 */
const TRANSIENT_NET_ERROR_CODES = new Set([
  'ERR_NETWORK_CHANGED',
  'ERR_NETWORK_IO_SUSPENDED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_ACCESS_DENIED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_CLOSED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_TIMED_OUT',
]);

const isTransientNetError = (error: unknown): boolean => {
  if (!error) return false;

  const message = error instanceof Error ? error.message : String(error);

  // Electron net errors are formatted as `net::ERR_XXX`.
  const match = message.match(/net::(ERR_[A-Z_]+)/);
  if (match && TRANSIENT_NET_ERROR_CODES.has(match[1])) return true;

  // Belt-and-suspenders: these only ever originate from the net loader.
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  return /net::ERR_/.test(message) && stack.includes('SimpleURLLoaderWrapper');
};

/**
 * Install global guards for the Electron main process. Must be called as early
 * as possible (before the rest of the app boots) so it catches errors from any
 * module's top-level / async work.
 */
export const installProcessErrorHandlers = () => {
  process.on('uncaughtException', (error) => {
    if (isTransientNetError(error)) {
      logger.warn('Ignoring transient network error in main process:', error.message);
      return;
    }

    // Re-throw so genuine bugs still surface as a crash instead of being
    // silently swallowed by this handler.
    logger.error('Uncaught exception in main process:', error);
    throw error;
  });

  process.on('unhandledRejection', (reason) => {
    if (isTransientNetError(reason)) {
      logger.warn(
        'Ignoring transient network rejection in main process:',
        reason instanceof Error ? reason.message : String(reason),
      );
      return;
    }

    // Installing this listener overrides Node's default
    // `--unhandled-rejections=throw`, so we must re-throw to preserve the fatal
    // behavior. Throwing here surfaces as an uncaughtException (handled above,
    // which also re-throws non-transient errors), instead of leaving the app
    // partially booted on a genuine failure (e.g. an unawaited app.bootstrap()).
    logger.error('Unhandled rejection in main process:', reason);
    throw reason;
  });

  logger.info('Process error handlers installed');
};
