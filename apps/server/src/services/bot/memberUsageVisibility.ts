import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/** A tenant configuration outage must not disclose usage or prevent delivery. */
export const getBotMemberTokenVisibility = async (): Promise<boolean> => {
  try {
    return (await getServerFeatureFlagsStateFromRuntimeConfig()).showMemberTokenUsage === true;
  } catch {
    return false;
  }
};
