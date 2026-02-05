import { useState } from 'react';

import { useToolStore } from '@/store/tool';
import type {KlavisServer} from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface UseKlavisServerActionsProps {
  identifier: string;
  onAuthRequired?: (oauthUrl: string, serverIdentifier: string) => void;
  server?: KlavisServer;
  serverName: string;
}

export const useKlavisServerActions = ({
  identifier,
  serverName,
  server,
  onAuthRequired,
}: UseKlavisServerActionsProps) => {
  const [isConnecting, setIsConnecting] = useState(false);

  const userId = useUserStore(userProfileSelectors.userId);
  const createKlavisServer = useToolStore((s) => s.createKlavisServer);
  const refreshKlavisServerTools = useToolStore((s) => s.refreshKlavisServerTools);
  const toggleDefaultPlugin = useUserStore((s) => s.toggleInboxAgentDefaultPlugin);

  const handleConnect = async () => {
    if (!userId || server) return;

    setIsConnecting(true);
    try {
      const newServer = await createKlavisServer({
        identifier,
        serverName,
        userId,
      });

      if (newServer) {
        const newPluginId = newServer.identifier;
        await toggleDefaultPlugin(newPluginId);

        if (newServer.isAuthenticated) {
          await refreshKlavisServerTools(newServer.identifier);
        } else if (newServer.oauthUrl) {
          onAuthRequired?.(newServer.oauthUrl, newServer.identifier);
        }
      }
    } catch (error) {
      console.error('[Klavis] Failed to connect server:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  return {
    handleConnect,
    isConnecting,
  };
};
