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
 * Whitelist arrays may hold emails as well as user IDs (admins configure
 * grayscale rollouts by email — see `evaluateFeatureFlag`). Resolve the
 * user's email only when some flag actually carries an email entry, so the
 * common all-boolean / all-userId path never touches the users table.
 */
const resolveEmailForEvaluation = async (
  flags: IFeatureFlags,
  userId?: string,
): Promise<string | undefined> => {
  if (!userId) return;

  const hasEmailEntry = Object.values(flags).some(
    (value) => Array.isArray(value) && value.some((entry) => entry.includes('@')),
  );
  if (!hasEmailEntry) return;

  try {
    const { UserModel } = await import('@/database/models/user');
    const { getServerDB } = await import('@/database/server');
    const user = await UserModel.findById(await getServerDB(), userId);
    return user?.email ?? undefined;
  } catch (error) {
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
