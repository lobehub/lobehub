import {
  closeContextMenu as closeWebContextMenu,
  showContextMenu as showWebContextMenu,
} from '@lobehub/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { electronSystemService } from '@/services/electron/system';

import { closeContextMenu, showContextMenu } from './index';
import type { NativeContextMenuItem } from './types';

vi.mock('@lobehub/ui', () => ({
  closeContextMenu: vi.fn(),
  showContextMenu: vi.fn(),
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    closePopupContextMenu: vi.fn(),
    popupContextMenu: vi.fn(),
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const stubDarwin = () => {
  window.lobeEnv = { platform: 'darwin' };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete window.lobeEnv;
});

afterEach(() => {
  delete window.lobeEnv;
});

describe('showContextMenu routing', () => {
  it('delegates to the web menu verbatim on non-darwin platforms', () => {
    const items: NativeContextMenuItem[] = [{ key: '1', label: 'Copy' }];
    const options = { iconAlign: 'center' as const };

    showContextMenu(items, options);

    expect(showWebContextMenu).toHaveBeenCalledWith(items, options);
    expect(electronSystemService.popupContextMenu).not.toHaveBeenCalled();
  });

  it('delegates to the web menu on darwin when the menu is not native-safe', () => {
    stubDarwin();
    const items = [{ extra: 'x', key: '1', label: 'Copy' }] as unknown as NativeContextMenuItem[];

    showContextMenu(items);

    expect(showWebContextMenu).toHaveBeenCalledWith(items, undefined);
    expect(electronSystemService.popupContextMenu).not.toHaveBeenCalled();
  });

  it('goes native on darwin when the menu is native-safe', () => {
    stubDarwin();
    vi.mocked(electronSystemService.popupContextMenu).mockResolvedValue({ clickedId: null });

    showContextMenu([{ key: '1', label: 'Copy' }]);

    expect(electronSystemService.popupContextMenu).toHaveBeenCalledTimes(1);
    expect(showWebContextMenu).not.toHaveBeenCalled();
  });

  it('falls back to the web menu when the native template would be empty', () => {
    stubDarwin();

    showContextMenu([]);

    expect(showWebContextMenu).toHaveBeenCalledWith([], undefined);
    expect(electronSystemService.popupContextMenu).not.toHaveBeenCalled();
  });
});

describe('native popup resolution', () => {
  it('invokes the matching handler once the IPC call resolves', async () => {
    stubDarwin();
    const onClick = vi.fn();
    vi.mocked(electronSystemService.popupContextMenu).mockResolvedValue({ clickedId: '0' });

    showContextMenu([{ key: '1', label: 'Copy', onClick }]);

    await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  it('invokes no handler when the menu is cancelled', async () => {
    stubDarwin();
    const onClick = vi.fn();
    vi.mocked(electronSystemService.popupContextMenu).mockResolvedValue({ clickedId: null });

    showContextMenu([{ key: '1', label: 'Copy', onClick }]);

    await flush();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not throw when the IPC call rejects, and invokes no handler', async () => {
    stubDarwin();
    const onClick = vi.fn();
    vi.mocked(electronSystemService.popupContextMenu).mockRejectedValue(new Error('boom'));

    expect(() => showContextMenu([{ key: '1', label: 'Copy', onClick }])).not.toThrow();

    await flush();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores a stale popup resolution and keeps the newer popup live', async () => {
    stubDarwin();

    let resolveA: (result: { clickedId: string | null }) => void = () => {};
    let resolveB: (result: { clickedId: string | null }) => void = () => {};
    const promiseA = new Promise<{ clickedId: string | null }>((resolve) => {
      resolveA = resolve;
    });
    const promiseB = new Promise<{ clickedId: string | null }>((resolve) => {
      resolveB = resolve;
    });

    vi.mocked(electronSystemService.popupContextMenu)
      .mockReturnValueOnce(promiseA)
      .mockReturnValueOnce(promiseB);

    const onClickA = vi.fn();
    const onClickB = vi.fn();

    showContextMenu([{ key: 'a', label: 'A', onClick: onClickA }]);
    showContextMenu([{ key: 'b', label: 'B', onClick: onClickB }]);

    resolveA({ clickedId: '0' });
    await flush();

    expect(onClickA).not.toHaveBeenCalled();
    expect(onClickB).not.toHaveBeenCalled();

    closeContextMenu();
    expect(electronSystemService.closePopupContextMenu).toHaveBeenCalledTimes(1);
    expect(closeWebContextMenu).not.toHaveBeenCalled();

    resolveB({ clickedId: '0' });
    await vi.waitFor(() => expect(onClickB).toHaveBeenCalledTimes(1));

    expect(onClickA).not.toHaveBeenCalled();
  });
});

describe('closeContextMenu routing', () => {
  it('routes to the native IPC after a native menu was shown', () => {
    stubDarwin();
    vi.mocked(electronSystemService.popupContextMenu).mockResolvedValue({ clickedId: null });
    showContextMenu([{ key: '1', label: 'Copy' }]);

    closeContextMenu();

    expect(electronSystemService.closePopupContextMenu).toHaveBeenCalledTimes(1);
    expect(closeWebContextMenu).not.toHaveBeenCalled();
  });

  it('routes to the web menu after a web menu was shown', () => {
    showContextMenu([{ key: '1', label: 'Copy' }]);

    closeContextMenu();

    expect(closeWebContextMenu).toHaveBeenCalledTimes(1);
    expect(electronSystemService.closePopupContextMenu).not.toHaveBeenCalled();
  });

  it('routes to the web menu once a native popup has settled after a click', async () => {
    stubDarwin();
    vi.mocked(electronSystemService.popupContextMenu).mockResolvedValue({ clickedId: '0' });
    showContextMenu([{ key: '1', label: 'Copy', onClick: vi.fn() }]);

    await flush();

    closeContextMenu();

    expect(closeWebContextMenu).toHaveBeenCalledTimes(1);
    expect(electronSystemService.closePopupContextMenu).not.toHaveBeenCalled();
  });

  it('routes to the web menu once a native popup has settled after a cancel', async () => {
    stubDarwin();
    vi.mocked(electronSystemService.popupContextMenu).mockResolvedValue({ clickedId: null });
    showContextMenu([{ key: '1', label: 'Copy' }]);

    await flush();

    closeContextMenu();

    expect(closeWebContextMenu).toHaveBeenCalledTimes(1);
    expect(electronSystemService.closePopupContextMenu).not.toHaveBeenCalled();
  });

  it('routes to the web menu after a native popup settles by rejecting', async () => {
    stubDarwin();
    vi.mocked(electronSystemService.popupContextMenu).mockRejectedValue(new Error('boom'));
    showContextMenu([{ key: '1', label: 'Copy' }]);

    await flush();

    closeContextMenu();

    expect(closeWebContextMenu).toHaveBeenCalledTimes(1);
    expect(electronSystemService.closePopupContextMenu).not.toHaveBeenCalled();
  });
});
