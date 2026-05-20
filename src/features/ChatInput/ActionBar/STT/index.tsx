import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import BrowserSTT from './browser';
import OpenaiSTT from './openai';

const STT = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { sttServer } = useUserStore(settingsSelectors.currentTTS, isEqual);
  const { enableSTT } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  if (!enableSTT) return;

  if (enableBusinessFeatures) {
    return <BrowserSTT mobile={mobile} />;
  }
  switch (sttServer) {
    case 'openai': {
      return <OpenaiSTT mobile={mobile} />;
    }
  }
  return <BrowserSTT mobile={mobile} />;
});

export default STT;
