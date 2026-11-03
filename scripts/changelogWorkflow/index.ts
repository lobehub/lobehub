import { consola } from 'consola';

import { buildStaticChangelog } from './buildStaticChangelog';

const run = () => {
  consola.start('Building static changelog...');
  buildStaticChangelog.run();
};

run();
