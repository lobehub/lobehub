import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

export const useShowMemberTokenUsage = () =>
  useServerConfigStore((s) => featureFlagsSelectors(s).showMemberTokenUsage === true);
