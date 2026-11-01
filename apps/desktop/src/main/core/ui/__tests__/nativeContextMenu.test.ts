import type { NativeContextMenuItemTemplate } from '@lobechat/electron-client-ipc';
import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeNativeContextMenuPopup,
  convertNativeContextMenuItems,
  popupNativeContextMenu,
} from '../nativeContextMenu';

const { buildFromTemplateMock, createMenuSymbolMock, loggerWarnMock } = vi.hoisted(() => ({
  buildFromTemplateMock: vi.fn(),
  createMenuSymbolMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: buildFromTemplateMock,
  },
  nativeImage: {
    createMenuSymbol: createMenuSymbolMock,
  },
}));

vi.mock('@/const/env', () => ({
  isDev: true,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
  }),
}));

const invokeClick = (options: MenuItemConstructorOptions) =>
  (options.click as (...args: any[]) => void)?.(
    undefined as any,
    undefined as any,
    undefined as any,
  );

const originalPlatform = process.platform;

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
};

const setSystemVersion = (version: string) => {
  Object.defineProperty(process, 'getSystemVersion', {
    configurable: true,
    value: vi.fn(() => version),
  });
};

describe('nativeContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('darwin');
    setSystemVersion('14.4.1');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  });

  describe('convertNativeContextMenuItems', () => {
    it('converts a normal item with label/sublabel/click', () => {
      const onItemClick = vi.fn();
      const items: NativeContextMenuItemTemplate[] = [
        { id: 'copy', label: 'Copy', sublabel: 'Cmd+C', type: 'normal' },
      ];

      const [result] = convertNativeContextMenuItems(items, onItemClick);

      expect(result.label).toBe('Copy');
      expect(result.sublabel).toBe('Cmd+C');
      expect(result.type).toBeUndefined();

      invokeClick(result);
      expect(onItemClick).toHaveBeenCalledWith('copy');
    });

    it('sets enabled: false only when explicitly disabled, otherwise omits the key', () => {
      const items: NativeContextMenuItemTemplate[] = [
        { enabled: false, id: 'a', label: 'A', type: 'normal' },
        { id: 'b', label: 'B', type: 'normal' },
      ];

      const [a, b] = convertNativeContextMenuItems(items, vi.fn());

      expect(a.enabled).toBe(false);
      expect('enabled' in b).toBe(false);
    });

    it('applies enabled: false to checkbox and submenu items too', () => {
      const items: NativeContextMenuItemTemplate[] = [
        { checked: false, enabled: false, id: 'toggle', label: 'Toggle', type: 'checkbox' },
        { enabled: false, label: 'More', submenu: [], type: 'submenu' },
      ];

      const [checkbox, submenu] = convertNativeContextMenuItems(items, vi.fn());

      expect(checkbox.enabled).toBe(false);
      expect(submenu.enabled).toBe(false);
    });

    it('converts a separator', () => {
      const [result] = convertNativeContextMenuItems([{ type: 'separator' }], vi.fn());
      expect(result).toEqual({ type: 'separator' });
    });

    it('converts a checkbox item with checked state and click wiring', () => {
      const onItemClick = vi.fn();
      const [result] = convertNativeContextMenuItems(
        [{ checked: true, id: 'toggle', label: 'Toggle', type: 'checkbox' }],
        onItemClick,
      );

      expect(result.type).toBe('checkbox');
      expect(result.checked).toBe(true);
      expect(result.label).toBe('Toggle');

      invokeClick(result);
      expect(onItemClick).toHaveBeenCalledWith('toggle');
    });

    it('attaches an icon to checkbox items when sfSymbol is provided', () => {
      const fakeImage = { isEmpty: () => false };
      createMenuSymbolMock.mockReturnValue(fakeImage);

      const [result] = convertNativeContextMenuItems(
        [
          {
            checked: false,
            id: 'toggle',
            label: 'Toggle',
            sfSymbol: 'doc.on.doc',
            type: 'checkbox',
          },
        ],
        vi.fn(),
      );

      expect(result.icon).toBe(fakeImage);
    });

    it('converts a submenu recursively, wiring no click handler even when id is present', () => {
      const [result] = convertNativeContextMenuItems(
        [
          {
            id: 'not-clickable',
            label: 'More',
            submenu: [{ id: 'child', label: 'Child', type: 'normal' }],
            type: 'submenu',
          },
        ],
        vi.fn(),
      );

      expect(result.label).toBe('More');
      expect('click' in result).toBe(false);
      expect(result.submenu).toHaveLength(1);
      expect((result.submenu as MenuItemConstructorOptions[])[0].label).toBe('Child');
    });

    it('attaches an icon to submenu items when sfSymbol is provided', () => {
      const fakeImage = { isEmpty: () => false };
      createMenuSymbolMock.mockReturnValue(fakeImage);

      const [result] = convertNativeContextMenuItems(
        [{ label: 'More', sfSymbol: 'doc.on.doc', submenu: [], type: 'submenu' }],
        vi.fn(),
      );

      expect(result.icon).toBe(fakeImage);
    });

    it('applies sublabel to checkbox and submenu items too, subject to the version rule', () => {
      const items: NativeContextMenuItemTemplate[] = [
        {
          checked: true,
          id: 'toggle',
          label: 'Toggle',
          sublabel: 'desc-checkbox',
          type: 'checkbox',
        },
        { label: 'More', sublabel: 'desc-submenu', submenu: [], type: 'submenu' },
      ];

      const [checkbox, submenu] = convertNativeContextMenuItems(items, vi.fn());

      expect(checkbox.sublabel).toBe('desc-checkbox');
      expect(submenu.sublabel).toBe('desc-submenu');
    });

    it('omits click wiring for clickable items without an id', () => {
      const [result] = convertNativeContextMenuItems([{ label: 'No id', type: 'normal' }], vi.fn());

      expect('click' in result).toBe(false);
    });
  });

  describe('macOS version degradation', () => {
    it('degrades header to separator and drops it when it is the first item at its level (macOS 13)', () => {
      setSystemVersion('13.0');

      const items: NativeContextMenuItemTemplate[] = [
        { label: 'Section', type: 'header' },
        { id: 'a', label: 'A', type: 'normal' },
      ];

      const result = convertNativeContextMenuItems(items, vi.fn());

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('A');
    });

    it('degrades header to a plain separator when it is not the first item at its level (macOS 13)', () => {
      setSystemVersion('13.0');

      const items: NativeContextMenuItemTemplate[] = [
        { id: 'a', label: 'A', type: 'normal' },
        { label: 'Section', type: 'header' },
        { id: 'b', label: 'B', type: 'normal' },
      ];

      const result = convertNativeContextMenuItems(items, vi.fn());

      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ type: 'separator' });
    });

    it('keeps header but drops sublabel on macOS 14.0', () => {
      setSystemVersion('14.0');

      const items: NativeContextMenuItemTemplate[] = [
        { label: 'Section', type: 'header' },
        { id: 'a', label: 'A', sublabel: 'desc', type: 'normal' },
      ];

      const [header, normal] = convertNativeContextMenuItems(items, vi.fn());

      expect(header).toEqual({ label: 'Section', type: 'header' });
      expect('sublabel' in normal).toBe(false);
    });

    it('keeps sublabel on macOS 14.4.1', () => {
      setSystemVersion('14.4.1');

      const items: NativeContextMenuItemTemplate[] = [
        { id: 'a', label: 'A', sublabel: 'desc', type: 'normal' },
      ];

      const [normal] = convertNativeContextMenuItems(items, vi.fn());

      expect(normal.sublabel).toBe('desc');
    });

    it('drops sublabel uniformly across normal/checkbox/submenu on macOS 14.0', () => {
      setSystemVersion('14.0');

      const items: NativeContextMenuItemTemplate[] = [
        { id: 'a', label: 'A', sublabel: 'd1', type: 'normal' },
        { checked: false, id: 'b', label: 'B', sublabel: 'd2', type: 'checkbox' },
        { label: 'C', sublabel: 'd3', submenu: [], type: 'submenu' },
      ];

      const [normal, checkbox, submenu] = convertNativeContextMenuItems(items, vi.fn());

      expect('sublabel' in normal).toBe(false);
      expect('sublabel' in checkbox).toBe(false);
      expect('sublabel' in submenu).toBe(false);
    });

    it('keeps sublabel uniformly across normal/checkbox/submenu on macOS 14.4.1', () => {
      setSystemVersion('14.4.1');

      const items: NativeContextMenuItemTemplate[] = [
        { id: 'a', label: 'A', sublabel: 'd1', type: 'normal' },
        { checked: false, id: 'b', label: 'B', sublabel: 'd2', type: 'checkbox' },
        { label: 'C', sublabel: 'd3', submenu: [], type: 'submenu' },
      ];

      const [normal, checkbox, submenu] = convertNativeContextMenuItems(items, vi.fn());

      expect(normal.sublabel).toBe('d1');
      expect(checkbox.sublabel).toBe('d2');
      expect(submenu.sublabel).toBe('d3');
    });
  });

  describe('sfSymbol icon fallback', () => {
    it('sets icon when createMenuSymbol returns a usable image', () => {
      const fakeImage = { isEmpty: () => false };
      createMenuSymbolMock.mockReturnValue(fakeImage);

      const [result] = convertNativeContextMenuItems(
        [{ id: 'a', label: 'A', sfSymbol: 'doc.on.doc', type: 'normal' }],
        vi.fn(),
      );

      expect(result.icon).toBe(fakeImage);
    });

    it('omits the icon key entirely when createMenuSymbol returns an empty image', () => {
      createMenuSymbolMock.mockReturnValue({ isEmpty: () => true });

      const [result] = convertNativeContextMenuItems(
        [{ id: 'a', label: 'A', sfSymbol: 'doc.on.doc', type: 'normal' }],
        vi.fn(),
      );

      expect('icon' in result).toBe(false);
      expect(loggerWarnMock).toHaveBeenCalled();
    });

    it('omits the icon key when createMenuSymbol throws', () => {
      createMenuSymbolMock.mockImplementation(() => {
        throw new Error('boom');
      });

      const [result] = convertNativeContextMenuItems(
        [{ id: 'a', label: 'A', sfSymbol: 'doc.on.doc', type: 'normal' }],
        vi.fn(),
      );

      expect('icon' in result).toBe(false);
    });

    it('never resolves an icon on non-darwin platforms', () => {
      setPlatform('win32');
      createMenuSymbolMock.mockReturnValue({ isEmpty: () => false });

      const [result] = convertNativeContextMenuItems(
        [{ id: 'a', label: 'A', sfSymbol: 'doc.on.doc', type: 'normal' }],
        vi.fn(),
      );

      expect('icon' in result).toBe(false);
      expect(createMenuSymbolMock).not.toHaveBeenCalled();
    });
  });

  describe('popup lifecycle', () => {
    const makeFakeMenu = () => ({
      closePopup: vi.fn(),
      popup: vi.fn(),
    });

    it('resolves the clicked id when an item is clicked', async () => {
      const fakeMenu = makeFakeMenu();
      buildFromTemplateMock.mockReturnValue(fakeMenu);
      const window = { isDestroyed: () => false } as any;

      const promise = popupNativeContextMenu(
        { items: [{ id: 'copy', label: 'Copy', type: 'normal' }] },
        window,
      );

      const template = buildFromTemplateMock.mock.calls[0][0] as MenuItemConstructorOptions[];
      invokeClick(template[0]);

      await expect(promise).resolves.toEqual({ clickedId: 'copy' });
    });

    it('resolves null when the popup closes without a click', async () => {
      vi.useFakeTimers();
      try {
        const fakeMenu = makeFakeMenu();
        buildFromTemplateMock.mockReturnValue(fakeMenu);
        const window = { isDestroyed: () => false } as any;

        const promise = popupNativeContextMenu(
          { items: [{ id: 'copy', label: 'Copy', type: 'normal' }] },
          window,
        );

        const popupOptions = fakeMenu.popup.mock.calls[0][0];
        popupOptions.callback();
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual({ clickedId: null });
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets a click that fires after the close callback still win (close-then-click)', async () => {
      vi.useFakeTimers();
      try {
        const fakeMenu = makeFakeMenu();
        buildFromTemplateMock.mockReturnValue(fakeMenu);
        const window = { isDestroyed: () => false } as any;

        const promise = popupNativeContextMenu(
          { items: [{ id: 'copy', label: 'Copy', type: 'normal' }] },
          window,
        );

        const template = buildFromTemplateMock.mock.calls[0][0] as MenuItemConstructorOptions[];
        const popupOptions = fakeMenu.popup.mock.calls[0][0];

        popupOptions.callback();
        invokeClick(template[0]);
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual({ clickedId: 'copy' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the click result when the close callback fires right after it (click-then-close), and releases the popup', async () => {
      vi.useFakeTimers();
      try {
        const fakeMenu = makeFakeMenu();
        buildFromTemplateMock.mockReturnValue(fakeMenu);
        const window = { isDestroyed: () => false } as any;

        const promise = popupNativeContextMenu(
          { items: [{ id: 'copy', label: 'Copy', type: 'normal' }] },
          window,
        );

        const template = buildFromTemplateMock.mock.calls[0][0] as MenuItemConstructorOptions[];
        const popupOptions = fakeMenu.popup.mock.calls[0][0];

        invokeClick(template[0]);
        expect(() => popupOptions.callback()).not.toThrow();
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual({ clickedId: 'copy' });

        closeNativeContextMenuPopup();
        expect(fakeMenu.closePopup).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves null immediately when the window is already destroyed, without building a menu', async () => {
      const window = { isDestroyed: () => true } as any;

      await expect(popupNativeContextMenu({ items: [] }, window)).resolves.toEqual({
        clickedId: null,
      });
      expect(buildFromTemplateMock).not.toHaveBeenCalled();
    });

    it('closes the previous popup when a new one opens, and the previous one resolves null', async () => {
      vi.useFakeTimers();
      try {
        const firstMenu = makeFakeMenu();
        const secondMenu = makeFakeMenu();
        buildFromTemplateMock.mockReturnValueOnce(firstMenu).mockReturnValueOnce(secondMenu);
        const window = { isDestroyed: () => false } as any;

        const firstPromise = popupNativeContextMenu(
          { items: [{ id: 'a', label: 'A', type: 'normal' }] },
          window,
        );
        const secondPromise = popupNativeContextMenu(
          { items: [{ id: 'b', label: 'B', type: 'normal' }] },
          window,
        );

        expect(firstMenu.closePopup).toHaveBeenCalled();

        const firstCallback = firstMenu.popup.mock.calls[0][0].callback;
        firstCallback();
        await vi.runAllTimersAsync();
        await expect(firstPromise).resolves.toEqual({ clickedId: null });

        const secondTemplate = buildFromTemplateMock.mock
          .calls[1][0] as MenuItemConstructorOptions[];
        invokeClick(secondTemplate[0]);
        await expect(secondPromise).resolves.toEqual({ clickedId: 'b' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('closeNativeContextMenuPopup closes the current popup and is a safe no-op when none is open', () => {
      expect(() => closeNativeContextMenuPopup()).not.toThrow();

      const fakeMenu = makeFakeMenu();
      buildFromTemplateMock.mockReturnValue(fakeMenu);
      const window = { isDestroyed: () => false } as any;
      void popupNativeContextMenu({ items: [{ id: 'a', label: 'A', type: 'normal' }] }, window);

      closeNativeContextMenuPopup();
      expect(fakeMenu.closePopup).toHaveBeenCalled();

      const callback = fakeMenu.popup.mock.calls[0][0].callback;
      callback();
    });
  });
});
