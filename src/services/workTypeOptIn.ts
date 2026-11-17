import { WORK_TYPES_HEADER } from '@lobechat/const';

import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { getServerConfigStoreState } from '@/store/serverConfig/store';

export const workTypeOptIn = () => {
  const config = getServerConfigStoreState();
  return {
    includeArtboardWorks: !!config && serverConfigSelectors.enableArtboard(config),
    includeFileWorks: true,
  };
};

export const workTypeOptInHeaders = (): Record<string, string> => {
  const { includeArtboardWorks, includeFileWorks } = workTypeOptIn();
  const types = [includeArtboardWorks && 'artboard', includeFileWorks && 'file'].filter(Boolean);
  return { [WORK_TYPES_HEADER]: types.join(',') };
};
