import { getJSONFromRedis, RedisKeys } from '@/server/modules/Redis';

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
    const redis = await getClient();
    if (!redis) return resolve();

    const key = keyOf(ref);
    const readCached = () => getJSONFromRedis<string>(redis, key).catch(() => null);
    const cached = await readCached();
    if (cached !== null) return cached;

    const commit = await resolve();
    // An import may have recorded a newer ref while GitHub was responding.
    const stored = await redis
      .set(key, JSON.stringify(commit), { nx: true, px: TTL_MS })
      .catch(() => undefined);
    if (stored === null) return (await readCached()) ?? commit;
    return commit;
  },

  /**
   * An import records its live ref before saving the installation.
   */
  async record(ref: GitHubRef, commit: string): Promise<void> {
    const redis = await getClient();
    await redis?.set(keyOf(ref), JSON.stringify(commit), { px: TTL_MS }).catch(() => undefined);
  },
};
