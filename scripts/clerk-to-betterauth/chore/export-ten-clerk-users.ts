/* eslint-disable unicorn/prefer-top-level-await, unicorn/no-process-exit */
import { createClerkClient } from '@clerk/backend';
import { writeFile } from 'node:fs/promises';

import { getClerkSecret, resolveDataPaths } from '../config';

const DEFAULT_OUTPUT = `${resolveDataPaths().baseDir}/clerk_users_sample.json`;
const LIMIT = 10;

const formatDuration = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

async function main() {
  const startedAt = Date.now();
  const outputPath = process.argv[2] ?? DEFAULT_OUTPUT;
  const clerk = createClerkClient({ secretKey: getClerkSecret() });

  console.log(`🚀 [clerk-sample] Fetch first ${LIMIT} users -> ${outputPath}`);

  const { data, totalCount } = await clerk.users.getUserList({
    limit: LIMIT,
    orderBy: '-created_at',
  });

  // 优先存 raw，便于你研究真实结构；若 raw 缺失则存精简数据
  const payload = data.map((user) => user.raw ?? user);

  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(
    `✅ [clerk-sample] Saved ${payload.length} users (totalCount=${totalCount ?? payload.length}) in ${formatDuration(
      Date.now() - startedAt,
    )}`,
  );
}

void main().catch((error) => {
  console.error('[clerk-sample] Failed:', error);
  process.exit(1);
});
