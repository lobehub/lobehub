export type FtsSearchReindexCommand = 'apply' | 'promote' | 'retire' | 'skip-failure' | 'status';

interface RunFtsSearchReindexCommandOptions<T> {
  command: FtsSearchReindexCommand;
  installCaptureInfrastructure: () => Promise<void>;
  run: () => Promise<T>;
  runWithLockRetry: (operation: () => Promise<void>) => Promise<void>;
}

/**
 * Runs one reindex command while keeping capture installation ahead of every apply mutation.
 *
 * Status, failure-skipping, promote, and retire commands intentionally execute without installing
 * database triggers, so PG-only self-hosted instances do not pay the Elasticsearch capture
 * overhead; promote already requires a drained Outbox, which implies capture is installed.
 */
export const runFtsSearchReindexCommand = async <T>({
  command,
  installCaptureInfrastructure,
  run,
  runWithLockRetry,
}: RunFtsSearchReindexCommandOptions<T>): Promise<T> => {
  if (command === 'apply') {
    await runWithLockRetry(installCaptureInfrastructure);
  }

  return run();
};
