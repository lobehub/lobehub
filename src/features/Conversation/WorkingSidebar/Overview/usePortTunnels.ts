import { isDesktop } from '@lobechat/const';
import type { DeviceListeningPort } from '@lobechat/types';
import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isSafeExternalUrl } from '@/features/Work/descriptors';
import { deviceService } from '@/services/device';
import {
  type DeviceTunnelLink,
  useFetchDeviceListeningPorts,
  useFetchDeviceTunnels,
} from '@/store/device';

/**
 * State and actions behind the Ports row.
 *
 * The rule worth keeping in one place: a link is stored clean and the token
 * that opens it is minted per action, so neither the UI nor the clipboard ever
 * holds a long-lived credential.
 */
export const usePortTunnels = (options: {
  /** Whether the working panel is showing; detection only runs while it is. */
  active: boolean;
  /** Project directory, so the device can say which ports are this project's. */
  cwd?: string;
  deviceId: string;
  onOpened: () => void;
  /** Whether the ports menu is open; the link list is only read while it is. */
  open: boolean;
}) => {
  const { active, cwd, deviceId, onOpened, open } = options;
  const { t } = useTranslation('chat');
  const [busySlug, setBusySlug] = useState<string>();
  /** The port being exposed — typed or detected — so its row can show progress. */
  const [creatingPort, setCreatingPort] = useState<number>();

  // Read whenever the panel shows, not only with the menu open: the row's
  // "N to open" count subtracts already-exposed ports, and without the list it
  // would count a port that already has a link.
  const {
    data: tunnels,
    error,
    isLoading,
    mutate,
  } = useFetchDeviceTunnels(deviceId, active || open);
  const detection = useFetchDeviceListeningPorts(deviceId, cwd, active);

  /**
   * Detected ports minus the ones already exposed on this device. Only the
   * project's own ports count as "available": a dev machine listens on dozens
   * of unrelated ports (databases, Docker, system services).
   */
  const { byPort, detected, others } = useMemo(() => {
    const ports = detection.data?.ports ?? [];
    const exposed = new Set((tunnels ?? []).map((link) => link.port));
    const fresh = ports.filter((p) => !exposed.has(p.port));
    return {
      byPort: new Map(ports.map((p) => [p.port, p])),
      detected: fresh.filter((p) => p.inProject),
      others: fresh.filter((p) => !p.inProject),
    };
  }, [detection.data, tunnels]);

  /**
   * Claim the tab while the click is still the browser's idea of user
   * activation — minting the token is a round trip, and a `window.open` after
   * it gets blocked as a popup. Desktop needs none of this: `window.open` is
   * routed to `shell.openExternal`, and a reserved `about:blank` would just
   * launch an empty browser tab.
   */
  const reserveTab = useCallback((): Window | null => {
    if (isDesktop) return null;
    const tab = window.open('about:blank', '_blank');
    // `noopener` can't be used here (it makes `open` return null, leaving
    // nothing to navigate), so sever the link while the tab is still
    // same-origin instead.
    if (tab) tab.opener = null;
    return tab;
  }, []);

  const navigateTab = useCallback((tab: Window | null, url: string) => {
    // Defense in depth: only ever hand http(s) to a tab or the shell.
    if (!isSafeExternalUrl(url)) {
      tab?.close();
      return;
    }
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openLink = useCallback(
    async (link: DeviceTunnelLink) => {
      const tab = reserveTab();
      if (!tab && !isDesktop) {
        toast.error(t('workingPanel.overview.ports.popupBlocked'));
        return;
      }

      setBusySlug(link.slug);
      try {
        const { openUrl } = await deviceService.openTunnel({ slug: link.slug });
        navigateTab(tab, openUrl);
        onOpened();
      } catch {
        tab?.close();
        toast.error(t('workingPanel.overview.ports.openFailed'));
      } finally {
        setBusySlug(undefined);
      }
    },
    [navigateTab, onOpened, reserveTab, t],
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

  /** Expose a detected port and open it. */
  const exposePort = useCallback(
    async (target: number) => {
      if (!Number.isInteger(target) || target < 1 || target > 65_535) {
        toast.error(t('workingPanel.overview.ports.invalidPort'));
        return;
      }

      const tab = reserveTab();
      if (!tab && !isDesktop) {
        toast.error(t('workingPanel.overview.ports.popupBlocked'));
        return;
      }

      setCreatingPort(target);
      try {
        const link = await deviceService.createTunnel({ deviceId, port: target });
        await mutate();
        // Choosing a port means "let me see it" — open it without a second click.
        navigateTab(tab, link.openUrl);
        onOpened();
      } catch {
        tab?.close();
        toast.error(t('workingPanel.overview.ports.createFailed'));
      } finally {
        setCreatingPort(undefined);
      }
    },
    [deviceId, mutate, navigateTab, onOpened, reserveTab, t],
  );

  return {
    busySlug,
    copyLink,
    creatingPort,
    detected,
    /** Detection info by port, to label exposed links with their process. */
    detectedByPort: byPort,
    /** False when the device can't detect (offline, or a client that predates it). */
    detectionAvailable: !!detection.data?.supported,
    // Validating, not loading: a manual rescan keeps the old data and must still spin.
    detectionLoading: detection.isValidating,
    error,
    exposePort,
    isLoading,
    openLink,
    refresh: mutate,
    refreshDetected: detection.mutate,
    otherPorts: others as DeviceListeningPort[],
    revokeLink,
    tunnels: tunnels ?? [],
  };
};
