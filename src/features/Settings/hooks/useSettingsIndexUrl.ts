import { useServerConfigStore } from '@/store/serverConfig';

import { getSettingsIndexUrl } from '../settingsIndexUrl';
import { useCategory } from './useCategory';

/**
 * Where `/settings` should land, or `undefined` until the server config has
 * loaded. The space set's first tab depends on server flags (billing, provider
 * visibility); deciding before they arrive — e.g. a cold Electron load, where
 * the config is fetched rather than injected — would commit to a later tab.
 */
export const useSettingsIndexUrl = (): string | undefined => {
  const groups = useCategory();
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  return serverConfigInit ? getSettingsIndexUrl(groups) : undefined;
};
