import path from 'node:path';

import { pruneMigrationSnapshots } from './core';

const metaDir = path.join(__dirname, '../../packages/database/migrations/meta');

const removed = pruneMigrationSnapshots(metaDir);

console.log(`🧹 pruned ${removed.length} old migration snapshot(s)`);
