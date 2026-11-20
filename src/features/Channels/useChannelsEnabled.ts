import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/** Before the per-user flags load the store holds defaults; wait instead of guessing. */
export const useChannelsEnabled = () =>
  useServerConfigStore((s) => s.serverConfigInit && serverConfigSelectors.enableChannels(s));
