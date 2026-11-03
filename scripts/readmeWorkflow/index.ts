import { consola } from 'consola';

import syncAgentIndex from './syncAgentIndex';
import syncPluginIndex from './syncPluginIndex';
import syncProviderIndex from './syncProviderIndex';

const runSync = async () => {
  consola.start('Start sync readme workflow...');
  await syncProviderIndex();
  await syncAgentIndex();
  await syncPluginIndex();
};

runSync();
