import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePortTunnels } from '../usePortTunnels';

const createTunnel = vi.hoisted(() => vi.fn());
const openTunnel = vi.hoisted(() => vi.fn());
const revokeTunnel = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const copyToClipboard = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
const tunnels = vi.hoisted(() => ({
  error: undefined as unknown,
  isLoading: false,
  value: [] as unknown[] | undefined,
}));
const isDesktop = vi.hoisted(() => ({ value: false }));
const detection = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
}));

vi.mock('@/services/device', () => ({
  deviceService: { createTunnel, openTunnel, revokeTunnel },
}));

const tunnelsEnabledArgs = vi.hoisted(() => [] as boolean[]);

vi.mock('@/store/device', () => ({
  useFetchDeviceListeningPorts: () => detection,
  useFetchDeviceTunnels: (_deviceId: string, enabled: boolean) => {
    tunnelsEnabledArgs.push(enabled);
    return {
      data: tunnels.value,
      error: tunnels.error,
      isLoading: tunnels.isLoading,
      mutate,
    };
  },
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return isDesktop.value;
  },
}));

vi.mock('@lobehub/ui', () => ({ copyToClipboard }));
vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const link = {
  createdAt: 1,
  deviceId: 'device-1',
  hostname: '3000--abcdefgh.lobe.sh',
  port: 3000,
  slug: 'abcdefgh',
  url: 'https://3000--abcdefgh.lobe.sh/',
};

const onOpened = vi.fn();
const setup = () =>
  renderHook(() =>
    usePortTunnels({ active: true, cwd: '/work/app', deviceId: 'device-1', onOpened, open: true }),
  );

/** A pre-opened tab: `window.open` is called before the token round trip. */
const tab = { close: vi.fn(), location: { href: '' }, opener: {} as unknown };

beforeEach(() => {
  vi.clearAllMocks();
  tunnels.value = [];
  tunnels.error = undefined;
  tunnels.isLoading = false;
  isDesktop.value = false;
  detection.data = undefined;
  detection.isLoading = false;
  detection.isValidating = false;
  tab.location.href = '';
  tab.opener = {};
  vi.stubGlobal(
    'open',
    vi.fn(() => tab),
  );
});

describe('usePortTunnels', () => {
  it('exposes a port and opens it straight away', async () => {
    createTunnel.mockResolvedValue({
      ...link,
      openUrl: 'https://3000--abcdefgh.lobe.sh/?token=fresh',
    });
    const { result } = setup();

    await act(() => result.current.exposePort(3000));

    expect(createTunnel).toHaveBeenCalledWith({ deviceId: 'device-1', port: 3000 });
    // Choosing a port means "let me see it": no second click to open it.
    expect(tab.location.href).toBe('https://3000--abcdefgh.lobe.sh/?token=fresh');
    expect(onOpened).toHaveBeenCalled();
  });

  it.each([0, 70_000, 80.5, Number.NaN])('refuses %j without calling the server', async (value) => {
    const { result } = setup();

    await act(() => result.current.exposePort(value));

    expect(toastError).toHaveBeenCalledWith('workingPanel.overview.ports.invalidPort');
    expect(createTunnel).not.toHaveBeenCalled();
  });

  it('opens an existing link with a freshly minted token, never the stored URL', async () => {
    tunnels.value = [link];
    openTunnel.mockResolvedValue({ openUrl: `${link.url}?token=minted`, url: link.url });
    const { result } = setup();

    await act(() => result.current.openLink(link));

    expect(openTunnel).toHaveBeenCalledWith({ slug: 'abcdefgh' });
    expect(tab.location.href).toBe('https://3000--abcdefgh.lobe.sh/?token=minted');
    // The clean URL 401s for anyone who doesn't already hold the session cookie.
    expect(tab.location.href).not.toBe(link.url);
  });

  it('puts an openable link on the clipboard, not the bare hostname', async () => {
    openTunnel.mockResolvedValue({ openUrl: `${link.url}?token=minted`, url: link.url });
    const { result } = setup();

    await act(() => result.current.copyLink(link));

    expect(copyToClipboard).toHaveBeenCalledWith('https://3000--abcdefgh.lobe.sh/?token=minted');
    expect(toastSuccess).toHaveBeenCalledWith('workingPanel.overview.ports.copied');
  });

  it('refreshes the list after revoking', async () => {
    revokeTunnel.mockResolvedValue({ success: true });
    const { result } = setup();

    await act(() => result.current.revokeLink(link));

    expect(revokeTunnel).toHaveBeenCalledWith({ slug: 'abcdefgh' });
    expect(mutate).toHaveBeenCalled();
    await waitFor(() => expect(result.current.busySlug).toBeUndefined());
  });

  it('reports a failed exposure instead of silently doing nothing', async () => {
    createTunnel.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await act(() => result.current.exposePort(5173));

    expect(toastError).toHaveBeenCalledWith('workingPanel.overview.ports.createFailed');
    // The reserved tab must not be left sitting on about:blank.
    expect(tab.close).toHaveBeenCalled();
    expect(result.current.creatingPort).toBeUndefined();
  });

  it('never navigates to a non-http URL the server might return', async () => {
    openTunnel.mockResolvedValue({ openUrl: 'javascript:alert(1)', url: link.url });
    const { result } = setup();

    await act(() => result.current.openLink(link));

    expect(tab.location.href).toBe('');
    expect(tab.close).toHaveBeenCalled();
  });

  describe('popup survival', () => {
    it('claims the tab before the token round trip, and severs its opener', async () => {
      openTunnel.mockResolvedValue({ openUrl: `${link.url}?token=minted`, url: link.url });
      const { result } = setup();

      const pending = act(() => result.current.openLink(link));
      // Claimed synchronously: after the await the click is no longer user
      // activation and the browser blocks the popup.
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
      await pending;

      expect(tab.opener).toBeNull();
    });

    it('reports a blocked popup instead of silently doing nothing', async () => {
      vi.stubGlobal(
        'open',
        vi.fn(() => null),
      );
      const { result } = setup();

      await act(() => result.current.openLink(link));

      expect(toastError).toHaveBeenCalledWith('workingPanel.overview.ports.popupBlocked');
      expect(openTunnel).not.toHaveBeenCalled();
    });

    it('opens directly on desktop, where window.open reaches the shell', async () => {
      isDesktop.value = true;
      openTunnel.mockResolvedValue({ openUrl: `${link.url}?token=minted`, url: link.url });
      const { result } = setup();

      await act(() => result.current.openLink(link));

      // No about:blank: a reserved tab would launch an empty browser window.
      expect(window.open).toHaveBeenCalledTimes(1);
      expect(window.open).toHaveBeenCalledWith(
        'https://3000--abcdefgh.lobe.sh/?token=minted',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  describe('list states', () => {
    it('keeps loading and failure distinct from an empty list', () => {
      tunnels.value = undefined;
      tunnels.isLoading = true;
      expect(setup().result.current).toMatchObject({ isLoading: true, tunnels: [] });

      tunnels.isLoading = false;
      tunnels.error = new Error('offline');
      // Callers need the error itself: "couldn't ask" must not render as
      // "nothing is exposed".
      expect(setup().result.current.error).toBeTruthy();
    });
  });

  describe('detected ports', () => {
    const port = (overrides: Record<string, unknown>) => ({
      command: 'node',
      inProject: true,
      loopback: 'both',
      port: 5173,
      ...overrides,
    });

    it('offers the project ports that are not exposed yet, and keeps the rest aside', () => {
      tunnels.value = [link]; // 3000 is already exposed
      detection.data = {
        ports: [
          port({ port: 3000 }),
          port({ port: 5173 }),
          port({ command: 'postgres', inProject: false, port: 5432 }),
        ],
        supported: true,
      };

      const { result } = setup();

      expect(result.current.detected.map((p) => p.port)).toEqual([5173]);
      expect(result.current.otherPorts.map((p) => p.port)).toEqual([5432]);
      expect(result.current.detectionAvailable).toBe(true);
    });

    it('drops a port from the detected list once it has a link', () => {
      tunnels.value = [link];
      detection.data = { ports: [port({ port: 3000 })], supported: true };

      // The exposed row on top already shows it, with its link.
      expect(setup().result.current).toMatchObject({ detected: [], otherPorts: [] });
    });

    it('reports no detection for a device that cannot answer', () => {
      detection.data = null;
      expect(setup().result.current).toMatchObject({ detected: [], detectionAvailable: false });
    });

    it('shows a rescan in progress even though the previous answer is still there', () => {
      detection.data = { ports: [port({ port: 3000 })], supported: true };
      detection.isValidating = true;
      expect(setup().result.current.detectionLoading).toBe(true);
    });
  });

  it('reads the link list while the panel shows, so the badge never counts an exposed port', () => {
    tunnelsEnabledArgs.length = 0;
    renderHook(() =>
      usePortTunnels({
        active: true,
        cwd: '/work/app',
        deviceId: 'device-1',
        onOpened,
        open: false,
      }),
    );
    // Menu closed, panel showing: the list must still be requested.
    expect(tunnelsEnabledArgs.at(-1)).toBe(true);
  });
});
