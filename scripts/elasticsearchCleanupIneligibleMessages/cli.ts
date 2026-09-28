import { runIneligibleMessageCleanupCli } from './index';

void runIneligibleMessageCleanupCli().catch((error: unknown) => {
  console.error(
    'Elasticsearch ineligible-message cleanup failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
