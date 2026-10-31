import debug from 'debug';
import semver from 'semver';

const log = debug('lobe-server:agent-cli-release');

/** One registry read serves every device card for this long. */
const CACHE_TTL_MS = 60 * 60_000;
/** A failed read is retried sooner, so a registry blip does not hide updates for an hour. */
const FAILURE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 5000;

interface CacheEntry {
  expiresAt: number;
  version: Promise<string | null>;
}

interface AgentCliReleaseServiceOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * Newest published release of an agent CLI, read from the npm registry so a
 * device card can tell its CLI is behind. Lookups are cached per package in
 * the process and concurrent callers share the in-flight request; a deployment
 * without registry access simply never reports a newer version.
 */
export class AgentCliReleaseService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor({ fetch = globalThis.fetch, now = Date.now }: AgentCliReleaseServiceOptions = {}) {
    this.fetch = fetch;
    this.now = now;
  }

  /** The `latest` dist-tag of `npmPackage`, or `null` when it cannot be read. */
  getLatestVersion(npmPackage: string): Promise<string | null> {
    const cached = this.cache.get(npmPackage);
    if (cached && cached.expiresAt > this.now()) return cached.version;

    const entry: CacheEntry = {
      expiresAt: this.now() + CACHE_TTL_MS,
      version: Promise.resolve(null),
    };
    entry.version = this.fetchLatestVersion(npmPackage).catch((error) => {
      log('latest version of %s unavailable: %O', npmPackage, error);
      entry.expiresAt = this.now() + FAILURE_TTL_MS;
      return null;
    });
    this.cache.set(npmPackage, entry);
    return entry.version;
  }

  private async fetchLatestVersion(npmPackage: string): Promise<string | null> {
    const res = await this.fetch(`https://registry.npmjs.org/${npmPackage}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`npm registry returned status ${res.status}`);

    const { version } = (await res.json()) as { version?: unknown };
    return typeof version === 'string' && semver.valid(version) ? version : null;
  }
}

export const agentCliRelease = new AgentCliReleaseService();
