import { setLoggerFactory } from '@lobechat/local-file-shell';
import debug from 'debug';
import { app } from 'electron';
import electronLog from 'electron-log';

import { getDesktopEnv } from '@/env';

/**
 * Electron never sets `NODE_ENV` for packaged builds, and the main bundle reads
 * env through a `{ ...process.env }` spread, so no build-time define reaches it
 * either. Gating log persistence on `NODE_ENV === 'production'` therefore
 * dropped *every* main-process log from the production log file — the released
 * app wrote nothing but electron-updater's own lines. `app.isPackaged` is the
 * signal that actually holds in a released build.
 */
const isPackagedBuild = () => Boolean(app?.isPackaged) || getDesktopEnv().NODE_ENV === 'production';

// Configure electron-log
electronLog.transports.file.level = 'info'; // Log info level and above in production
// Errors are the whole point of the log file — don't let a chatty info stream
// rotate them away before a user can attach the log to a bug report.
electronLog.transports.file.maxSize = 10 * 1024 * 1024;
electronLog.transports.console.level = isPackagedBuild()
  ? 'info' // Show info level and above in production environment
  : 'debug'; // Show more logs in development environment

// Create namespaced debugger
export const createLogger = (namespace: string) => {
  const debugLogger = debug(namespace);

  return {
    debug: (message, ...args) => {
      debugLogger(message, ...args);
    },
    error: (message, ...args) => {
      // A packaged build has no console anyone can read, so its errors must reach
      // the log file. Development keeps `console.error` — the terminal is where a
      // dev reads them, and electron-log's console transport would print a second
      // copy of every line.
      if (isPackagedBuild()) {
        electronLog.error(`[${namespace}]`, message, ...args);
      } else {
        console.error(message, ...args);
      }
    },
    info: (message, ...args) => {
      if (isPackagedBuild()) {
        electronLog.info(`[${namespace}]`, message, ...args);
      }

      debugLogger(`INFO: ${message}`, ...args);
    },
    verbose: (message, ...args) => {
      electronLog.verbose(message, ...args);
      if (getDesktopEnv().DEBUG_VERBOSE) {
        debugLogger(`VERBOSE: ${message}`, ...args);
      }
    },
    warn: (message, ...args) => {
      if (isPackagedBuild()) {
        electronLog.warn(`[${namespace}]`, message, ...args);
      }
      debugLogger(`WARN: ${message}`, ...args);
    },
  };
};

// Route @lobechat/local-file-shell logs through desktop's electron-log +
// debug pipeline so search failures from the sunk contentSearch / fileSearch
// modules land in the same production log file users attach for support
// (regression introduced when the modules moved out of the desktop tree).
setLoggerFactory(createLogger);
