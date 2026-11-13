import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { getServerConfigStoreState } from '@/store/serverConfig/store';

export const workTypeOptIn = () => {
  const config = getServerConfigStoreState();
  return {
    includeArtboardWorks: !!config && serverConfigSelectors.enableArtboard(config),
    includeFileWorks: true,
  };
};
