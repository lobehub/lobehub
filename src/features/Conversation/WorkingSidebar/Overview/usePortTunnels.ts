import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isSafeExternalUrl } from '@/features/Work/descriptors';
import { deviceService } from '@/services/device';
import { type DeviceTunnelLink, useFetchDeviceTunnels } from '@/store/device';

/**
 * State and actions behind the Ports row.
 *
 * The rule worth keeping in one place: a link is stored clean and the token
 * that opens it is minted per action, so neither the UI nor the clipboard ever
 * holds a long-lived credential.
 */
export const usePortTunnels = (deviceId: string, open: boolean, onOpened: () => void) => {
  const { t } = useTranslation('chat');
  const [port, setPort] = useState('');
  const [busySlug, setBusySlug] = useState<string>();
  const [creating, setCreating] = useState(false);

  const { data: tunnels = [], mutate } = useFetchDeviceTunnels(deviceId, open);

  const openExternal = useCallback((url: string) => {
    // Defense in depth: only ever hand http(s) to the shell.
    if (isSafeExternalUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openLink = useCallback(
    async (link: DeviceTunnelLink) => {
      setBusySlug(link.slug);
      try {
        const { openUrl } = await deviceService.openTunnel({ slug: link.slug });
        openExternal(openUrl);
        onOpened();
      } catch {
        toast.error(t('workingPanel.overview.ports.openFailed'));
      } finally {
        setBusySlug(undefined);
      }
    },
    [onOpened, openExternal, t],
  );

  const copyLink = useCallback(
    async (link: DeviceTunnelLink) => {
      try {
        // The clean URL 401s for anyone without the session cookie, so what
        // goes on the clipboard has to be an openable one.
        const { openUrl } = await deviceService.openTunnel({ slug: link.slug });
        await copyToClipboard(openUrl);
        toast.success(t('workingPanel.overview.ports.copied'));
      } catch {
        toast.error(t('workingPanel.overview.ports.openFailed'));
      }
    },
    [t],
  );

  const revokeLink = useCallback(
    async (link: DeviceTunnelLink) => {
      setBusySlug(link.slug);
      try {
        await deviceService.revokeTunnel({ slug: link.slug });
        await mutate();
        toast.success(t('workingPanel.overview.ports.revoked'));
      } catch {
        toast.error(t('workingPanel.overview.ports.revokeFailed'));
      } finally {
        setBusySlug(undefined);
      }
    },
    [mutate, t],
  );

  const exposePort = useCallback(async () => {
    const parsed = Number(port.trim());
    if (!port.trim() || !Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      toast.error(t('workingPanel.overview.ports.invalidPort'));
      return;
    }

    setCreating(true);
    try {
      const link = await deviceService.createTunnel({ deviceId, port: parsed });
      setPort('');
      await mutate();
      // Typing a port means "let me see it" — open it without a second click.
      openExternal(link.openUrl);
      onOpened();
    } catch {
      toast.error(t('workingPanel.overview.ports.createFailed'));
    } finally {
      setCreating(false);
    }
  }, [deviceId, mutate, onOpened, openExternal, port, t]);

  return { busySlug, copyLink, creating, exposePort, openLink, port, revokeLink, setPort, tunnels };
};
