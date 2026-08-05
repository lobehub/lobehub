import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@lobehub/ui/base-ui';

import { useToolStore } from '@/store/tool';
import { type ComposioServer, ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { useUserStore } from '@/store/user';

import { ComposioOAuthPopupBlockedError } from './useComposioOAuth';

interface UseComposioServerActionsProps {
  appSlug: string;
  identifier: string;
  label: string;
  onAuthRequired?: (redirectUrl: string, serverIdentifier: string, oauthWindow?: Window | null) => void;
  onBeforeAuth?: (serverIdentifier: string) => Window | null;
  onCancelAuth?: () => void;
  server?: ComposioServer;
}

export const useComposioServerActions = ({
  identifier,
  appSlug,
  label,
  server,
  onAuthRequired,
  onBeforeAuth,
  onCancelAuth,
}: UseComposioServerActionsProps) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const { t } = useTranslation('onboarding');

  const createComposioConnection = useToolStore((s) => s.createComposioConnection);
  const refreshComposioConnectionStatus = useToolStore((s) => s.refreshComposioConnectionStatus);
  const reauthorizeComposioConnection = useToolStore((s) => s.reauthorizeComposioConnection);
  const toggleDefaultPlugin = useUserStore((s) => s.toggleInboxAgentDefaultPlugin);

  const notifyConnectError = () => {
    toast.error(t('proSettings.connectors.connectFailed'));
  };

  const notifyPopupBlocked = () => {
    toast.error(t('proSettings.connectors.popupBlocked'));
  };

  const handleConnect = async () => {
    if (server) return;

    setIsConnecting(true);
    try {
      const oauthWindow = onBeforeAuth?.(identifier);
      const newServer = await createComposioConnection({
        appSlug,
        identifier,
        label,
      });

      if (!newServer) {
        onCancelAuth?.();
        notifyConnectError();
        return;
      }

      if (newServer.status === ComposioServerStatus.ACTIVE) {
        onCancelAuth?.();
        await refreshComposioConnectionStatus(newServer.identifier);
      } else if (newServer.redirectUrl) {
        onAuthRequired?.(newServer.redirectUrl, newServer.identifier, oauthWindow);
      } else {
        onCancelAuth?.();
        notifyConnectError();
        return;
      }

      try {
        await toggleDefaultPlugin(newServer.identifier);
      } catch (error) {
        console.error('[Composio] Failed to pin default plugin after connect:', error);
      }
    } catch (error) {
      onCancelAuth?.();
      console.error('[Composio] Failed to connect server:', error);
      if (error instanceof ComposioOAuthPopupBlockedError) {
        notifyPopupBlocked();
      } else {
        notifyConnectError();
      }
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
      const oauthWindow = onBeforeAuth?.(server.identifier);
      const newServer = await reauthorizeComposioConnection(server.identifier);
      if (!newServer?.redirectUrl) {
        onCancelAuth?.();
        notifyConnectError();
        return;
      }

      onAuthRequired?.(newServer.redirectUrl, newServer.identifier, oauthWindow);
    } catch (error) {
      onCancelAuth?.();
      console.error('[Composio] Failed to re-authorize server:', error);
      if (error instanceof ComposioOAuthPopupBlockedError) {
        notifyPopupBlocked();
      } else {
        notifyConnectError();
      }
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
