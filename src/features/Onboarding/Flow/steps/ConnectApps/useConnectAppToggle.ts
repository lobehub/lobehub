import { useCallback, useState } from 'react';

import { useComposioOAuth } from '@/routes/onboarding/components/ComposioServerList/hooks/useComposioOAuth';
import { useComposioServerActions } from '@/routes/onboarding/components/ComposioServerList/hooks/useComposioServerActions';
import { useToolStore } from '@/store/tool';
import { ComposioServerStatus, composioStoreSelectors } from '@/store/tool/slices/composioStore';

interface UseConnectAppToggleProps {
  appSlug: string;
  identifier: string;
  label: string;
}

export const useConnectAppToggle = ({ appSlug, identifier, label }: UseConnectAppToggleProps) => {
  const server = useToolStore(composioStoreSelectors.getServerByIdentifier(identifier));
  const removeComposioConnection = useToolStore((s) => s.removeComposioConnection);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const { isWaitingAuth, openOAuthWindow } = useComposioOAuth({ serverStatus: server?.status });
  const { isConnecting, handleConnect, handleReauthorize } = useComposioServerActions({
    appSlug,
    identifier,
    label,
    onAuthRequired: openOAuthWindow,
    server,
  });

  const isConnected = server?.status === ComposioServerStatus.ACTIVE;

  const onToggle = useCallback(
    async (checked: boolean) => {
      if (checked) {
        if (isConnected) return;
        if (server) await handleReauthorize();
        else await handleConnect();
      } else {
        if (!isConnected) return;
        setIsDisconnecting(true);
        try {
          await removeComposioConnection(identifier);
        } finally {
          setIsDisconnecting(false);
        }
      }
    },
    [isConnected, server, handleReauthorize, handleConnect, removeComposioConnection, identifier],
  );

  return {
    checked: isConnected,
    loading: isConnecting || isWaitingAuth || isDisconnecting,
    onToggle,
  };
};
