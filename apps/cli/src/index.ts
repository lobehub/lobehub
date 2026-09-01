import { reportDaemonStartupError } from './daemon/manager';
import { createProgram } from './program';
import { log } from './utils/logger';

function formatError(error: unknown): string {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.message && !details.includes(current.message)) {
      details.push(current.message);
    }
    if (typeof current !== 'object') {
      if (details.length === 0) details.push(String(current));
      break;
    }

    const candidate = current as { cause?: unknown; code?: unknown };
    if (typeof candidate.code === 'string' && !details.includes(candidate.code)) {
      details.push(candidate.code);
    }
    current = candidate.cause;
  }

  return details.join(': ') || String(error);
}

void createProgram()
  .parseAsync(process.argv, { from: 'node' })
  .catch(async (error: unknown) => {
    const message = formatError(error);
    await reportDaemonStartupError(message);
    log.error(message);
    process.exit(1);
  });
