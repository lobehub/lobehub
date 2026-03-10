'use client';

import { CredentialsManager } from '@lobechat/builtin-tool-credentials/client';
import { memo, useCallback } from 'react';

import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { keyVaultsConfigSelectors } from '@/store/user/selectors';

const CredentialsManagerPanel = memo(() => {
  const keyVaults = useUserStore(
    (s) => keyVaultsConfigSelectors.keyVaultsSettings(s) as Record<string, any>,
  );
  const refreshUserState = useUserStore((s) => s.refreshUserState);

  const persistKeyVaults = useCallback(
    async (next: Record<string, any>) => {
      await userService.updateUserSettings({ keyVaults: next });
      await refreshUserState();
    },
    [refreshUserState],
  );

  return <CredentialsManager keyVaults={keyVaults} onPersist={persistKeyVaults} />;
});

CredentialsManagerPanel.displayName = 'CredentialsManagerPanel';

export default CredentialsManagerPanel;
