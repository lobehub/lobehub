import { runElasticsearchFtsSearchSyncCli } from './index';

void runElasticsearchFtsSearchSyncCli().then((exitCode) => {
  process.exit(exitCode);
});
