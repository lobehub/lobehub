import { RedisKeys } from '@/server/modules/Redis';

import { readThroughRedis } from './cache';
import { getRedisServiceClient } from './client';

const TTL_MS = 5 * 60 * 1000;

interface GitHubRef {
  branch: string;
  owner: string;
  repo: string;
}

const getClient = () => getRedisServiceClient('integrations');
const keyOf = ({ branch, owner, repo }: GitHubRef) =>
  RedisKeys.integrations.gitHubRefCommit(owner.toLowerCase(), repo.toLowerCase(), branch);

export const gitHubRefs = {
  /**
   * The commit a ref points at, shared by every user's update check for five
   * minutes. Refs are resolved without credentials, so the answer is public and
   * the lookups draw on one small per-address GitHub quota. Without Redis each
   * check resolves live.
   */
  async remember(ref: GitHubRef, resolve: () => Promise<string>): Promise<string> {
    return readThroughRedis(await getClient(), keyOf(ref), resolve, { ttlMs: TTL_MS });
  },

  /**
   * Replace the remembered commit with one just resolved live. An import
   * records what it installed before saving, so a check can never offer an
   * older commit as an update.
   */
  async record(ref: GitHubRef, commit: string): Promise<void> {
    const redis = await getClient();
    await redis?.set(keyOf(ref), JSON.stringify(commit), { px: TTL_MS }).catch(() => undefined);
  },
};
