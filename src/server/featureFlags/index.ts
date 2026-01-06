import { EdgeConfig } from '@lobechat/edge-config';
import createDebug from 'debug';

import {
  DEFAULT_FEATURE_FLAGS,
  getServerFeatureFlagsValue,
  mapFeatureFlagsEnvToState,
} from '@/config/featureFlags';
import { merge } from '@/utils/merge';

const debug = createDebug('lobe:featureFlags');

/**
 * Get feature flags from EdgeConfig with fallback to environment variables
 * @param userId - Optional user ID for user-specific feature flag evaluation
 */
export const getServerFeatureFlagsFromEdgeConfig = async (userId?: string) => {
  // Try to get feature flags from EdgeConfig first
  if (EdgeConfig.isEnabled()) {
    try {
      const edgeConfig = new EdgeConfig();
      const edgeFeatureFlags = await edgeConfig.getFeatureFlags();

      if (edgeFeatureFlags && Object.keys(edgeFeatureFlags).length > 0) {
        // Merge EdgeConfig flags with defaults
        const mergedFlags = merge(DEFAULT_FEATURE_FLAGS, edgeFeatureFlags);
        debug('Using EdgeConfig flags for user: %s', userId || 'anonymous');
        return mergedFlags;
      } else {
        debug('EdgeConfig returned empty/null/undefined, falling back to environment variables');
      }
    } catch (error) {
      console.error(
        '[FeatureFlags] Failed to fetch feature flags from EdgeConfig, falling back to environment variables:',
        error,
      );
    }
  } else {
    debug('EdgeConfig not enabled, using environment variables');
  }

  // Fallback to environment variable-based feature flags
  const envFlags = getServerFeatureFlagsValue();
  debug('Using environment variable flags for user: %s', userId || 'anonymous');
  return envFlags;
};

/**
 * Get server feature flags from EdgeConfig and map them to state with user ID
 * @param userId - Optional user ID for user-specific feature flag evaluation
 */
export const getServerFeatureFlagsStateFromEdgeConfig = async (userId?: string) => {
  const flags = await getServerFeatureFlagsFromEdgeConfig(userId);
  return mapFeatureFlagsEnvToState(flags, userId);
};
