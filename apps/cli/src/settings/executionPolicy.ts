import fs from 'node:fs';
import path from 'node:path';

import type { LocalSandboxPolicyOverlay } from '@lobechat/device-sandbox';

import { getTrpcClient } from '../api/client';
import { getValidToken } from '../auth/refresh';
import { readCliApiKeyEnv } from '../constants/auth';
import { log } from '../utils/logger';
import { type CommandMode, parseCommandMode } from './commandMode';
import { SETTINGS_DIR } from './index';

/**
 * `getTrpcClient()` calls `process.exit(1)` when it cannot resolve credentials
 * from the env or stored login — a hard failure appropriate for a deliberate,
 * foreground CLI subcommand, but not for this best-effort background check: a
 * `lh connect --token <jwt>` session authenticates with an in-memory token
 * that was never written to the env or the credentials store (see
 * `createLambdaClient`'s doc comment in `api/client.ts`), so it would resolve
 * nothing here and take the whole daemon down on the first sandboxed command.
 * Check resolvability first and skip the call entirely rather than risk that —
 * an explicit-token session simply never gets a server push-down and falls
 * back to its cache/strictest default, which is safe, just not fresh.
 */
const hasResolvableAuth = async (): Promise<boolean> => {
  if (process.env.LOBEHUB_JWT) return true;
  if (readCliApiKeyEnv()) return true;
  return (await getValidToken()) !== null;
};

const CACHE_FILE = path.join(SETTINGS_DIR, 'execution-policy-cache.json');

/**
 * How long a resolved policy is trusted before the next `runCommand` call
 * triggers a re-fetch. Deliberately not a background timer: a daemon that
 * runs commands rarely has nothing to gain from ticking in the background,
 * and one that runs them often re-checks on essentially every burst anyway.
 */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Only `commandMode` is persisted — see {@link resolveExecutionPolicyOverlay}'s doc comment for why the overlay isn't. */
interface CachedPolicy {
  commandMode?: CommandMode;
}

interface ResolvedPushDown {
  commandMode: CommandMode | undefined;
  overlay: LocalSandboxPolicyOverlay | undefined;
}

let memo: { at: number; resolved: ResolvedPushDown } | undefined;
let inFlight: Promise<ResolvedPushDown> | undefined;

const readCache = (): CachedPolicy | undefined => {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Partial<CachedPolicy>;
    return { commandMode: parseCommandMode(parsed.commandMode) };
  } catch {
    return undefined;
  }
};

const writeCache = (entry: CachedPolicy) => {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry), 'utf8');
  } catch (error) {
    log.debug(`Could not persist execution-policy cache: ${(error as Error).message}`);
  }
};

/** Test seam only. */
export const resetExecutionPolicyCache = () => {
  memo = undefined;
  inFlight = undefined;
};

/**
 * Fetch and memoize the admin-configured execution policy for the current
 * user, deriving both values `runCommand` needs from a single round trip.
 * Never throws.
 */
async function resolvePushDown(): Promise<ResolvedPushDown> {
  if (memo && Date.now() - memo.at < REFRESH_INTERVAL_MS) return memo.resolved;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (!(await hasResolvableAuth())) {
        throw new Error('no resolvable CLI credentials for this session');
      }

      const client = await getTrpcClient();
      const policy = await client.executionPolicy.get.mutate();
      const commandMode = policy ? parseCommandMode(policy.commandMode) : undefined;
      const overlay: LocalSandboxPolicyOverlay | undefined = policy
        ? {
            allowedNetworkDomains: policy.allowedNetworkDomains,
            deniedReadRoots: policy.deniedReadRoots,
            deniedWriteRoots: policy.deniedWriteRoots,
            envAllowlist: policy.envAllowlist,
            readableRoots: policy.readableRoots,
            writableRoots: policy.writableRoots,
          }
        : undefined;

      const resolved = { commandMode, overlay };
      memo = { at: Date.now(), resolved };
      writeCache({ commandMode });
      return resolved;
    } catch (error) {
      log.debug(
        `Execution-policy fetch failed, falling back to cache: ${(error as Error).message}`,
      );

      // `commandMode` fails to the last known-good value (or, absent one, the
      // strictest bound) — see `resolvePushedCommandMode`'s doc comment. The
      // filesystem/network overlay does NOT get the same treatment: it only
      // ever narrows an ALREADY-sandboxed run (the run's sandbox/host choice
      // is untouched by this), so falling back to "no overlay" just means
      // today's plain Local Sandbox default applies — already a safe,
      // restrictive baseline, not a security regression. That also means it
      // doesn't need disk persistence.
      const cached = readCache();
      const commandMode = cached ? cached.commandMode : 'sandbox';
      const resolved = { commandMode, overlay: undefined };
      memo = { at: Date.now(), resolved };
      return resolved;
    } finally {
      inFlight = undefined;
    }
  })();

  return inFlight;
}

/**
 * Resolve the `commandMode` an admin has pushed down for the current user, or
 * `undefined` when there is none (unrestricted — `resolveCommandMode`'s
 * existing local/env resolution applies unchanged).
 *
 * Never throws and never returns a mode looser than what a prior successful
 * fetch observed:
 * - Fetch succeeds → cache and return it (including `undefined`, which
 *   correctly relaxes a previously-cached stricter mode once the admin lifts
 *   it).
 * - Fetch fails, a prior successful fetch exists → return that cached mode.
 * - Fetch fails, never fetched successfully before (first connection,
 *   offline) → `'sandbox'`, the strictest bound, rather than silently
 *   running unrestricted.
 *
 * The caller still runs this through `mergeCommandMode` (via
 * `resolveCommandMode(pushed)`), which only ever tightens — so even if this
 * function's fail-safe default were wrong, it cannot loosen the mode below
 * what the device's own settings already impose.
 */
export async function resolvePushedCommandMode(): Promise<CommandMode | undefined> {
  return (await resolvePushDown()).commandMode;
}

/**
 * Resolve the admin-configured Local Sandbox overlay for the current user
 * (extra writable roots, denied roots, a replacement network allowlist, …),
 * or `undefined` when there is none or the fetch failed. Only meaningful for
 * a run that is already sandboxed — pass straight to `createLocalSandboxPolicy`'s
 * `overlay` option.
 */
export async function resolveExecutionPolicyOverlay(): Promise<
  LocalSandboxPolicyOverlay | undefined
> {
  return (await resolvePushDown()).overlay;
}
