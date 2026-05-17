'use client';

import { memo, useEffect } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

const isDevEnv = process.env.NODE_ENV === 'development';

const DevFlagOverrideHydrator = memo(() => {
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const syncDevFlagOverrides = useServerConfigStore((s) => s.syncDevFlagOverrides);

  useEffect(() => {
    if (!isDevEnv) return;
    syncDevFlagOverrides();
  }, [serverConfigInit, syncDevFlagOverrides]);

  return null;
});

DevFlagOverrideHydrator.displayName = 'DevFlagOverrideHydrator';

export default DevFlagOverrideHydrator;
