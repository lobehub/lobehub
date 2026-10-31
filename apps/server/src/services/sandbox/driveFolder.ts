import type { SandboxStorageClaim } from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';

import { MarketService } from '@/server/services/market';

import { SandboxStorageFilesError } from './storageFiles';

const log = debug('lobe-server:sandbox:drive-folder');

/**
 * How long a folder that was there is believed to still be there.
 *
 * A run resolves its placement several times — the prompt, then every tool
 * call — and each would otherwise ask the drive again. Only a positive answer
 * is kept, and briefly: a folder someone deletes shows up as gone within this
 * window, while a missing one is asked about every time so it is noticed the
 * moment it comes back.
 */
const EXISTS_TTL_MS = 15_000;

/**
 * The most folders remembered at once. A long-lived server sees every
 * workspace's drives, so the cache sheds the oldest entries rather than grow
 * with them.
 */
const EXISTS_MAX_ENTRIES = 1000;

const existsCache = new Map<string, number>();

/** Drop what has expired, then the oldest beyond the cap — a Map iterates in insertion order. */
const remember = (cacheKey: string) => {
  const now = Date.now();
  existsCache.delete(cacheKey);
  for (const [key, at] of existsCache) {
    if (now - at >= EXISTS_TTL_MS) existsCache.delete(key);
  }
  while (existsCache.size >= EXISTS_MAX_ENTRIES) {
    const oldest = existsCache.keys().next().value;
    if (oldest === undefined) break;
    existsCache.delete(oldest);
  }
  existsCache.set(cacheKey, now);
};

interface DriveFolderInput {
  claim: SandboxStorageClaim;
  /** Relative to the drive's root. */
  path: string;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Whether a folder a topic picked is still on the drive.
 *
 * `false` only on the drive's own "nothing there" answer. Anything else — the
 * drive unreachable, a refusal — is `undefined`, which a caller treats as
 * "keep the choice": a run that cannot ask must not lose its folder over it,
 * and the execution plane fences the path either way.
 */
export const driveFolderExists = async ({
  claim,
  path,
  userId,
  workspaceId,
}: DriveFolderInput): Promise<boolean | undefined> => {
  const cacheKey = `${claim.key}\0${path}`;
  const cachedAt = existsCache.get(cacheKey);
  if (cachedAt !== undefined && Date.now() - cachedAt < EXISTS_TTL_MS) return true;
  if (cachedAt !== undefined) existsCache.delete(cacheKey);

  try {
    await new MarketService({
      userInfo: { sandboxStorage: claim, userId, workspaceId: workspaceId ?? undefined },
    })
      .getSandboxStorageClient()
      .listFiles({ path });
    remember(cacheKey);

    return true;
  } catch (error) {
    existsCache.delete(cacheKey);
    if (error instanceof SandboxStorageFilesError && error.status === 404) return false;

    log('Could not check drive folder %s on %s: %O', path, claim.key, error);
    return undefined;
  }
};

/** For tests: how many folders are remembered. */
export const driveFolderCacheSize = () => existsCache.size;

/** Forget what is known about a drive's folders, after a write that may have moved them. */
export const forgetDriveFolders = (storageKey: string) => {
  for (const key of existsCache.keys()) {
    if (key.startsWith(`${storageKey}\0`)) existsCache.delete(key);
  }
};
