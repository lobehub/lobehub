import { app } from 'electron';

import { captureMainConsole, captureRendererLogs } from './capture';
import { resolveLogLevel } from './layout';
import {
  closeStructuredLogsSync,
  openStructuredLogs,
  setStructuredLogLevel,
  writeStructuredLog,
} from './sink';

export { rawConsole } from './capture';
export type { LogLevel, LogProcess, LogRecord } from './layout';
export { flushStructuredLogs, getStructuredLogDirectory, writeStructuredLog } from './sink';

/**
 * Starts writing `<userData>/logs/{main,renderer}.jsonl` for this run, in dev and
 * packaged builds alike. Must run after `pre-app-init` pinned `userData`, so
 * every dev instance writes into its own profile.
 */
export const installStructuredLogging = () => {
  captureMainConsole();
  captureRendererLogs(app);
  // Stamp the clean exit as soon as Electron finishes quitting; `process.on('exit')`
  // in the sink runs again later and also covers exits that skip `quit`.
  app.once('quit', (_event, exitCode) => closeStructuredLogsSync({ exitCode }));
  openStructuredLogs({
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    minLevel: resolveLogLevel({ debugLogging: false, isPackaged: app.isPackaged }),
    userDataPath: app.getPath('userData'),
  })
    .then((manifest) =>
      writeStructuredLog({
        args: [{ appVersion: manifest.appVersion, isPackaged: manifest.isPackaged }],
        level: 'info',
        message: 'structured logging started',
        ns: 'structuredLog',
        process: 'main',
      }),
    )
    .catch((error) => {
      process.stderr.write(`[structuredLog] failed to open log files: ${String(error)}\n`);
    });
};

/** Applies the persisted Debug logs setting (`debugLoggingEnabled`) to this run. */
export const applyDebugLogging = (enabled: boolean) =>
  setStructuredLogLevel(resolveLogLevel({ debugLogging: enabled, isPackaged: app.isPackaged }));
