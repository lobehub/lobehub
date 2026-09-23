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
const tunnels = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock('@/services/device', () => ({
  deviceService: { createTunnel, openTunnel, revokeTunnel },
}));

vi.mock('@/store/device', () => ({
  useFetchDeviceTunnels: () => ({ data: tunnels.value, mutate }),
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
const setup = () => renderHook(() => usePortTunnels('device-1', true, onOpened));

beforeEach(() => {
  vi.clearAllMocks();
  tunnels.value = [];
  vi.stubGlobal('open', vi.fn());
});

describe('usePortTunnels', () => {
  it('exposes a port and opens it straight away', async () => {
    createTunnel.mockResolvedValue({
      ...link,
      openUrl: 'https://3000--abcdefgh.lobe.sh/?token=fresh',
    });
    const { result } = setup();

    act(() => result.current.setPort('3000'));
    await act(() => result.current.exposePort());

    expect(createTunnel).toHaveBeenCalledWith({ deviceId: 'device-1', port: 3000 });
    // Typing a port means "let me see it": no second click to open it.
    expect(window.open).toHaveBeenCalledWith(
      'https://3000--abcdefgh.lobe.sh/?token=fresh',
      '_blank',
      'noopener,noreferrer',
    );
    expect(result.current.port).toBe('');
    expect(onOpened).toHaveBeenCalled();
  });

  it.each(['0', '70000', 'abc', '', '  ', '80.5'])(
    'refuses %j without calling the server',
    async (value) => {
      const { result } = setup();

      act(() => result.current.setPort(value));
      await act(() => result.current.exposePort());

      expect(toastError).toHaveBeenCalledWith('workingPanel.overview.ports.invalidPort');
      expect(createTunnel).not.toHaveBeenCalled();
    },
  );

  it('opens an existing link with a freshly minted token, never the stored URL', async () => {
    tunnels.value = [link];
    openTunnel.mockResolvedValue({ openUrl: `${link.url}?token=minted`, url: link.url });
    const { result } = setup();

    await act(() => result.current.openLink(link));

    expect(openTunnel).toHaveBeenCalledWith({ slug: 'abcdefgh' });
    expect(window.open).toHaveBeenCalledWith(
      'https://3000--abcdefgh.lobe.sh/?token=minted',
      '_blank',
      'noopener,noreferrer',
    );
    // The clean URL 401s for anyone who doesn't already hold the session cookie.
    expect(window.open).not.toHaveBeenCalledWith(link.url, expect.anything(), expect.anything());
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

    act(() => result.current.setPort('5173'));
    await act(() => result.current.exposePort());

    expect(toastError).toHaveBeenCalledWith('workingPanel.overview.ports.createFailed');
    expect(window.open).not.toHaveBeenCalled();
    expect(result.current.creating).toBe(false);
  });

  it('never opens a non-http URL the server might return', async () => {
    openTunnel.mockResolvedValue({ openUrl: 'javascript:alert(1)', url: link.url });
    const { result } = setup();

    await act(() => result.current.openLink(link));

    expect(window.open).not.toHaveBeenCalled();
  });
});
