import { useState } from 'react';

import { useToolStore } from '@/store/tool';
import { type ComposioServer, ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { useUserStore } from '@/store/user';

interface UseComposioServerActionsProps {
  appSlug: string;
  identifier: string;
  label: string;
  onAuthRequired?: (redirectUrl: string, serverIdentifier: string) => void;
  server?: ComposioServer;
}

export const useComposioServerActions = ({
  identifier,
  appSlug,
  label,
  server,
  onAuthRequired,
}: UseComposioServerActionsProps) => {
  const [isConnecting, setIsConnecting] = useState(false);

  const createComposioConnection = useToolStore((s) => s.createComposioConnection);
  const refreshComposioConnectionStatus = useToolStore((s) => s.refreshComposioConnectionStatus);
  const reauthorizeComposioConnection = useToolStore((s) => s.reauthorizeComposioConnection);
  const toggleDefaultPlugin = useUserStore((s) => s.toggleInboxAgentDefaultPlugin);

  const handleConnect = async () => {
    if (server) return;

    setIsConnecting(true);
    try {
      const newServer = await createComposioConnection({
        appSlug,
        identifier,
        label,
      });

      if (newServer) {
        const newPluginId = newServer.identifier;
        await toggleDefaultPlugin(newPluginId);

        if (newServer.status === ComposioServerStatus.ACTIVE) {
          await refreshComposioConnectionStatus(newServer.identifier);
        } else if (newServer.redirectUrl) {
          onAuthRequired?.(newServer.redirectUrl, newServer.identifier);
        }
      }
    } catch (error) {
      console.error('[Composio] Failed to connect server:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  // Re-mint a fresh link (the prior one likely expired) instead of reopening the
  // stale redirectUrl, so a pending/errored row can always be retried.
  const handleReauthorize = async () => {
    if (!server) return;

    setIsConnecting(true);
    try {
      const newServer = await reauthorizeComposioConnection(server.identifier);
      if (newServer?.redirectUrl) {
        onAuthRequired?.(newServer.redirectUrl, newServer.identifier);
      }
    } catch (error) {
      console.error('[Composio] Failed to re-authorize server:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  return {
    handleConnect,
    handleReauthorize,
    isConnecting,
  };
};
