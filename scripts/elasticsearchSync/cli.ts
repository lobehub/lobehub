import { runElasticsearchSyncCli } from './index';

void runElasticsearchSyncCli().then((exitCode) => {
  process.exit(exitCode);
});
