import debug from 'debug';
import electronLog from 'electron-log';

import { getDesktopEnv } from '@/env';

// Configure electron-log
electronLog.transports.file.level = 'info'; // Log info level and above in production
electronLog.transports.console.level =
  getDesktopEnv().NODE_ENV === 'development'
    ? 'debug' // 开发环境显示更多日志
    : 'info'; // 生产环境显示 info 及以上级别

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
