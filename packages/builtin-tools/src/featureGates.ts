import { DashboardIdentifier, LegacyDashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { SessionIdentifier } from '@lobechat/builtin-tool-session';
import type { IFeatureFlagsState, UserLab } from '@lobechat/types';

/** Builtin tools that exist only while a runtime feature flag is on for the user. */
export const FEATURE_GATED_TOOLS: Record<string, keyof IFeatureFlagsState> = {
  [DashboardIdentifier]: 'enableDashboard',
  // A legacy pinned or replayed id must stay behind the same flag.
  [LegacyDashboardIdentifier]: 'enableDashboard',
};

/**
 * Identifiers to drop from a run's tool pool for the user's resolved flags.
 * Fails closed: a flag that is unset or anything but `true` hides its tool.
 * Hosts add these to the run's disabled identifiers, which leave the pool
 * outright — explicit activation cannot bring them back.
 */
export const getFeatureDisabledToolIds = (flags: Partial<IFeatureFlagsState> | undefined) =>
  Object.entries(FEATURE_GATED_TOOLS)
    .filter(([, flag]) => flags?.[flag] !== true)
    .map(([identifier]) => identifier);

/** Whether a builtin tool may be offered / listed for the user's resolved flags. */
export const isToolEnabledByFeatureFlags = (
  identifier: string,
  flags: Partial<IFeatureFlagsState> | undefined,
) => {
  const flag = FEATURE_GATED_TOOLS[identifier];
  return !flag || flags?.[flag] === true;
};

/** Builtin tools that exist only while the user turned a Labs switch on. */
export const LAB_GATED_TOOLS: Record<string, keyof UserLab> = {
  [SessionIdentifier]: 'enableBetterCodingExperience',
};

/** Identifiers to drop from a run's tool pool for the user's Labs; fails closed like flags. */
export const getLabDisabledToolIds = (lab: Partial<UserLab> | null | undefined) =>
  Object.entries(LAB_GATED_TOOLS)
    .filter(([, key]) => lab?.[key] !== true)
    .map(([identifier]) => identifier);

/** Whether a builtin tool may be offered / listed for the user's Labs. */
export const isToolEnabledByLab = (
  identifier: string,
  lab: Partial<UserLab> | null | undefined,
) => {
  const key = LAB_GATED_TOOLS[identifier];
  return !key || lab?.[key] === true;
};
