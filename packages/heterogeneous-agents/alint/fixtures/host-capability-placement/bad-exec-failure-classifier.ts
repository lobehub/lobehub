// Fixture: src/errors/processFailure.ts — under the ./errors entry, which the web app imports to render error specs.
import { classifyCliQuotaMessage } from './cliQuota';

/**
 * Process-level failure classification for `lh hetero exec` runs: maps the
 * spawn errno, exit code and stderr of the CLI process to a status guide.
 */
// alint-expect
export const classifyHeteroProcessFailure = (params: { code?: string; stderr: string }) => {
  if (params.code === 'ENOENT' || /spawn \S+ ENOENT/.test(params.stderr)) return 'cli-not-found';
  return classifyCliQuotaMessage(params.stderr) ? 'rate-limited' : 'unknown';
};
