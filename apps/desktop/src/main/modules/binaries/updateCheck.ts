import type { BinaryUpdateInfo, CheckBinaryUpdateParams } from '@lobechat/electron-client-ipc';
import semver from 'semver';

import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';

const logger = createLogger('modules:binaries:updateCheck');

/**
 * npm registry sources for CLI binaries.
 *
 * Keyed by the binary *name* (the command users type), not the agent type.
 * Only CLIs with a trustworthy npm distribution are listed; CLIs installed via
 * native installers or PyPI are excluded.
 *
 * Note: upgrade commands are intentionally omitted from Layer 1. The detected
 * CLI may have been installed via Homebrew, a native installer, or other
 * channels where an npm command would create a conflicting installation.
 * Installation-source detection and one-click upgrade guidance are deferred
 * to Layer 3.
 */
export const CLI_UPDATE_SOURCES: Record<string, { npmPackage: string }> = {
  amp: { npmPackage: '@sourcegraph/amp' },
  claude: { npmPackage: '@anthropic-ai/claude-code' },
  codebuddy: { npmPackage: '@tencent-ai/codebuddy-code' },
  codex: { npmPackage: '@openai/codex' },
  gemini: { npmPackage: '@google/gemini-cli' },
  opencode: { npmPackage: 'opencode-ai' },
  qwen: { npmPackage: '@qwen-code/qwen-code' },
};

const NPM_REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 4_000;
const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1_000; // 6 hours
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes

/**
 * Cache stores only the registry's latest version string, not the comparison
 * result. This way the expensive npm fetch is cached (TTL), but
 * `updateAvailable` is always recomputed against the caller's current
 * installed version — so a user who upgrades and re-detects within the TTL
 * gets a correct result instead of a stale `2.0.0 → 2.0.0`.
 */
interface CacheEntry {
  checkedAt: number;
  /** Present only when the fetch returned a valid semver string. */
  latestVersion?: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * Fetch the latest version string for an npm package.
 * Returns `undefined` on any failure (timeout, non-200, invalid JSON, …).
 */
async function fetchLatestVersion(npmPackage: string): Promise<string | undefined> {
  const url = `${NPM_REGISTRY}/${npmPackage}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await netFetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a `BinaryUpdateInfo` from the latest version and the user's current
 * version. Upgrade commands are intentionally omitted in Layer 1 — see
 * `CLI_UPDATE_SOURCES` comment above.
 */
function buildUpdateInfo(
  latestVersion: string | undefined,
  currentVersion: string,
): BinaryUpdateInfo {
  if (!latestVersion || !semver.valid(latestVersion)) {
    return { updateAvailable: false };
  }

  const updateAvailable = semver.gt(latestVersion, currentVersion);
  return updateAvailable
    ? { latestVersion, updateAvailable: true }
    : { latestVersion, updateAvailable: false };
}

/**
 * Check whether a CLI binary has a newer version available on npm.
 *
 * - No background timer; fires on-demand only when a UI surface mounts.
 * - In-memory cache de-duplicates: success TTL 6 h, failure TTL 10 min.
 * - Caches the registry's `latestVersion` only; `updateAvailable` is always
 *   recomputed from the caller's `currentVersion`, so a user who upgrades and
 *   re-detects within the TTL gets a correct result.
 * - Any failure silently returns `{ updateAvailable: false }`, never throws.
 */
export async function checkBinaryUpdate(
  params: CheckBinaryUpdateParams,
): Promise<BinaryUpdateInfo> {
  const { name, currentVersion } = params;
  const source = CLI_UPDATE_SOURCES[name];

  if (!source) return { updateAvailable: false };

  if (!semver.valid(currentVersion)) {
    logger.debug(`Invalid current version for "${name}": ${currentVersion}`);
    return { updateAvailable: false };
  }

  const cached = cache.get(source.npmPackage);
  if (cached) {
    const ttl = cached.latestVersion ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
    if (Date.now() - cached.checkedAt < ttl) {
      return buildUpdateInfo(cached.latestVersion, currentVersion);
    }
  }

  const latestVersion = await fetchLatestVersion(source.npmPackage);

  // Validate before caching — a non-empty invalid string must not get the
  // success TTL.
  const validated = latestVersion && semver.valid(latestVersion) ? latestVersion : undefined;

  cache.set(source.npmPackage, { checkedAt: Date.now(), latestVersion: validated });

  return buildUpdateInfo(validated, currentVersion);
}

/**
 * Clear the update-check cache. Mainly useful for testing.
 */
export function clearUpdateCache(): void {
  cache.clear();
}

/**
 * Batch-check updates for multiple binaries.
 * Each check runs independently; one failure does not affect others.
 */
export async function checkBinaryUpdates(
  params: CheckBinaryUpdateParams[],
): Promise<BinaryUpdateInfo[]> {
  return Promise.all(params.map((param) => checkBinaryUpdate(param)));
}
