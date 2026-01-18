import debug from 'debug';
import electronLog from 'electron-log';

import { getDesktopEnv } from '@/env';

// Configure electron-log
electronLog.transports.file.level = 'info'; // Log info level and above in production
electronLog.transports.console.level =
  getDesktopEnv().NODE_ENV === 'development'
    ? 'debug' // Show more logs in development
    : 'warn'; // Only show warnings and errors in production

// Create namespaced debugger
export const createLogger = (namespace: string) => {
  const debugLogger = debug(namespace);

  return {
    debug: (message, ...args) => {
      debugLogger(message, ...args);
    },
    error: (message, ...args) => {
      if (getDesktopEnv().NODE_ENV === 'production') {
        electronLog.error(message, ...args);
      } else {
        console.error(message, ...args);
      }
    },
    info: (message, ...args) => {
      if (getDesktopEnv().NODE_ENV === 'production') {
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
      if (getDesktopEnv().NODE_ENV === 'production') {
        electronLog.warn(message, ...args);
      }
      debugLogger(`WARN: ${message}`, ...args);
    },
  };
};
