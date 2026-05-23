import { createProgram } from './program';
import { log } from './utils/logger';

void createProgram()
  .parseAsync(process.argv, { from: 'node' })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    process.exit(1);
  });
