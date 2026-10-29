import { describeScopedNotFound } from './api/workspace';
import { hydrateJwtFromFile } from './auth/envJwt';
import { reportDaemonStartupError } from './daemon/manager';
import { createProgram } from './program';
import { formatError } from './utils/error';
import { log } from './utils/logger';

hydrateJwtFromFile();

void createProgram()
  .parseAsync(process.argv, { from: 'node' })
  .catch(async (error: unknown) => {
    const hint = describeScopedNotFound(error);
    const message = hint ? `${formatError(error)}. ${hint}` : formatError(error);
    await reportDaemonStartupError(message);
    log.error(message);
    process.exit(1);
  });
