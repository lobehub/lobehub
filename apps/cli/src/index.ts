import { reportDaemonStartupError } from './daemon/manager';
import { createProgram } from './program';
import { formatError } from './utils/error';
import { log } from './utils/logger';

void createProgram()
  .parseAsync(process.argv, { from: 'node' })
  .catch(async (error: unknown) => {
    const message = formatError(error);
    await reportDaemonStartupError(message);
    log.error(message);
    process.exit(1);
  });
