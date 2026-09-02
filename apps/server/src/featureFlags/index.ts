import createDebug from 'debug';
import { z } from 'zod';

import type { IFeatureFlags } from '@/config/featureFlags';
import {
  DEFAULT_FEATURE_FLAGS,
  FeatureFlagsSchema,
  getExplicitServerFeatureFlags,
  mapFeatureFlagsEnvToState,
} from '@/config/featureFlags';
import type {
  RuntimeConfigDomain,
  RuntimeConfigProvider,
  RuntimeConfigSelector,
} from '@/server/runtimeConfig';
import {
  CompositeRuntimeConfigProvider,
  EnvRuntimeConfigProvider,
  RedisRuntimeConfigProvider,
} from '@/server/runtimeConfig';
import { merge } from '@/utils/merge';

const debug = createDebug('lobe:featureFlags');

const FEATURE_FLAGS_DOMAIN: RuntimeConfigDomain<IFeatureFlags> = {
  cacheTtlMs: 5000,
  getStorageKey: () => 'runtime-config:feature-flags:published',
  getVersionKey: () => 'runtime-config:feature-flags:version',
  key: 'feature-flags',
  schema: FeatureFlagsSchema,
};

const FEATURE_FLAG_OVERRIDE_DOMAIN: RuntimeConfigDomain<Record<string, boolean>> = {
  cacheNullSnapshots: false,
  cacheTtlMs: 30_000,
  getStorageKey: (selector?: RuntimeConfigSelector) => {
    if (!selector || selector.scope !== 'user')
      return 'runtime-config:feature-flags:user:anonymous';

    return `runtime-config:feature-flags:user:${selector.id}`;
  },
  key: 'feature-flags-user-overrides',
  schema: z.record(z.string(), z.boolean()),
};

let featureFlagsProvider: RuntimeConfigProvider<IFeatureFlags> | null = null;
let featureFlagsOverrideProvider: RuntimeConfigProvider<Record<string, boolean>> | null = null;

export const applyDevelopmentFeatureFlagDefaults = (
  flags: IFeatureFlags,
  snapshot?: Partial<IFeatureFlags>,
) => {
  if (process.env.NODE_ENV !== 'development') return flags;

  if (process.env.FORCE_ENABLE_WORKSPACE_IN_DEV === 'false') {
    // Opting out must also neutralize the isDev schema default, otherwise the
    // disabled path is untestable locally; an explicit value from the shared
    // runtime config still wins.
    return snapshot && 'workspace' in snapshot ? flags : { ...flags, workspace: false };
  }

  return { ...flags, workspace: true };
};

const getFeatureFlagsProvider = () => {
  featureFlagsProvider ??= new CompositeRuntimeConfigProvider(
    new RedisRuntimeConfigProvider(FEATURE_FLAGS_DOMAIN),
    // Expose only explicitly-configured env flags; schema defaults are merged in
    // getMergedFeatureFlags, so the snapshot stays distinguishable from defaults.
    new EnvRuntimeConfigProvider(FEATURE_FLAGS_DOMAIN, {
      getSnapshotData: () => getExplicitServerFeatureFlags(),
    }),
  );

  return featureFlagsProvider;
};

const getFeatureFlagOverrideProvider = () => {
  featureFlagsOverrideProvider ??= new RedisRuntimeConfigProvider(FEATURE_FLAG_OVERRIDE_DOMAIN);

  return featureFlagsOverrideProvider;
};

const getMergedFeatureFlags = async (userId?: string) => {
  const globalSnapshot = await getFeatureFlagsProvider().getSnapshot({ scope: 'global' });

  // Shared runtime config can contain production allowlists even in local development.
  // Apply development defaults after the global snapshot; user-specific overrides below still win.
  const globalFlags = applyDevelopmentFeatureFlagDefaults(
    merge(DEFAULT_FEATURE_FLAGS, globalSnapshot?.data || {}),
    globalSnapshot?.data,
  );

  if (!userId) {
    return globalFlags;
  }

  const userOverrideSnapshot = await getFeatureFlagOverrideProvider().getSnapshot({
    id: userId,
    scope: 'user',
  });

  if (!userOverrideSnapshot) {
    return globalFlags;
  }

  return merge(globalFlags, userOverrideSnapshot.data as Partial<IFeatureFlags>);
};

/**
 * Get feature flags from RuntimeConfig with fallback to environment variables
 * @param userId - Optional user ID for user-specific feature flag evaluation
 */
export const getServerFeatureFlagsFromRuntimeConfig = async (userId?: string) => {
  const flags = await getMergedFeatureFlags(userId);

  debug('Using runtime feature flags for user: %s', userId || 'anonymous');

  return flags;
};

/**
 * The only flags whose whitelist arrays are ever matched against an email —
 * see `mapFeatureFlagsEnvToState`, where they are the sole `evaluateFeatureFlag`
 * calls that receive `userEmail`. Every other flag is evaluated by user ID
 * alone, so an '@' in one of those arrays can never change an outcome and must
 * not be allowed to trigger a users-table read.
 */
const EMAIL_AWARE_FLAG_KEYS = ['agent_share'] as const satisfies readonly (keyof IFeatureFlags)[];

const EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Bounded so a burst of distinct users cannot grow the map without limit in a
 * long-lived server process. Eviction is plain insertion-order (oldest first),
 * which is enough here: entries are cheap and expire on their own anyway.
 */
const EMAIL_CACHE_MAX_ENTRIES = 1000;

const emailCache = new Map<string, { email: string | undefined; expiresAt: number }>();

const readCachedEmail = (userId: string) => {
  const cached = emailCache.get(userId);
  if (!cached) return;
  if (cached.expiresAt <= Date.now()) {
    emailCache.delete(userId);
    return;
  }
  return cached;
};

const writeCachedEmail = (userId: string, email: string | undefined) => {
  // Refresh insertion order so the entry counts as recently written.
  emailCache.delete(userId);
  emailCache.set(userId, { email, expiresAt: Date.now() + EMAIL_CACHE_TTL_MS });

  while (emailCache.size > EMAIL_CACHE_MAX_ENTRIES) {
    const oldest = emailCache.keys().next();
    if (oldest.done) break;
    emailCache.delete(oldest.value);
  }
};

/** Test-only escape hatch so cached emails cannot leak across test cases. */
export const clearFeatureFlagEmailCache = () => emailCache.clear();

/**
 * Whitelist arrays may hold emails as well as user IDs (admins configure
 * grayscale rollouts by email — see `evaluateFeatureFlag`). Feature flags are
 * evaluated on essentially every tRPC procedure, so this runs on the hot path
 * and is kept off the database twice over:
 *
 * 1. Only the two email-aware flags are inspected for an '@' entry, so the
 *    common configuration (all booleans / user-ID arrays) never looks anything
 *    up.
 * 2. Resolved emails are memoized per user for {@link EMAIL_CACHE_TTL_MS}, so
 *    repeated evaluations within one user's session hit memory instead of the
 *    users table. A stale email only matters while an admin is rolling out by
 *    email to a user who just changed their address — bounded by the TTL.
 *
 * Exported (rather than kept module-private) so it has its own focused unit
 * tests instead of only being exercised indirectly through the full
 * RuntimeConfigProvider chain in `getServerFeatureFlagsStateFromRuntimeConfig`.
 */
export const resolveEmailForEvaluation = async (
  flags: IFeatureFlags,
  userId?: string,
): Promise<string | undefined> => {
  if (!userId) return;

  const hasEmailEntry = EMAIL_AWARE_FLAG_KEYS.some((key) => {
    const value = flags[key];
    return Array.isArray(value) && value.some((entry) => entry.includes('@'));
  });
  if (!hasEmailEntry) return;

  const cached = readCachedEmail(userId);
  if (cached) return cached.email;

  try {
    const { UserModel } = await import('@/database/models/user');
    const { getServerDB } = await import('@/database/server');
    const user = await UserModel.findById(await getServerDB(), userId);
    const email = user?.email ?? undefined;
    writeCachedEmail(userId, email);
    return email;
  } catch (error) {
    // Deliberately not cached: a transient DB failure must not pin the user to
    // "no email" (and therefore out of an email whitelist) for the whole TTL.
    debug('Failed to resolve user email for feature flag evaluation: %O', error);
    return;
  }
};

/**
 * Get server feature flags from RuntimeConfig and map them to state with user ID
 * @param userId - Optional user ID for user-specific feature flag evaluation
 */
export const getServerFeatureFlagsStateFromRuntimeConfig = async (userId?: string) => {
  const flags = await getServerFeatureFlagsFromRuntimeConfig(userId);
  const userEmail = await resolveEmailForEvaluation(flags, userId);
  return mapFeatureFlagsEnvToState(flags, userId, userEmail);
};
