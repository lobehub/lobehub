'use client';

import { memo, useEffect } from 'react';

import { useFaviconSetters } from '@/layout/GlobalProvider/FaviconProvider';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';

const DynamicFavicon = memo(() => {
  const isRunning = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const { setFavicon } = useFaviconSetters();

  useEffect(() => {
    setFavicon(isRunning ? 'progress' : 'default');
  }, [isRunning, setFavicon]);

  return null;
});

DynamicFavicon.displayName = 'DynamicFavicon';

export default DynamicFavicon;
