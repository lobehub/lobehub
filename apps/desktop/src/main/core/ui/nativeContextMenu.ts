import type {
  NativeContextMenuItemTemplate,
  PopupContextMenuParams,
  PopupContextMenuResult,
  SFSymbol,
} from '@lobechat/electron-client-ipc';
import type { BrowserWindow, MenuItemConstructorOptions, NativeImage } from 'electron';
import { Menu, nativeImage } from 'electron';

import { isDev } from '@/const/env';
import { createLogger } from '@/utils/logger';

const logger = createLogger('core:nativeContextMenu');

interface MacMenuCapabilities {
  supportsHeader: boolean;
  supportsSublabel: boolean;
}

const parseDarwinVersion = (version: string): { major: number; minor: number } => {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return { major, minor };
};

const getMacMenuCapabilities = (): MacMenuCapabilities => {
  if (process.platform !== 'darwin') return { supportsHeader: true, supportsSublabel: true };

  const { major, minor } = parseDarwinVersion(process.getSystemVersion());
  return {
    supportsHeader: major >= 14,
    supportsSublabel: major > 14 || (major === 14 && minor >= 4),
  };
};

const resolveMenuSymbolIcon = (sfSymbol?: SFSymbol): NativeImage | undefined => {
  if (!sfSymbol || process.platform !== 'darwin') return undefined;

  try {
    const image = nativeImage.createMenuSymbol(sfSymbol);
    if (image.isEmpty()) {
      if (isDev) logger.warn(`SF Symbol "${sfSymbol}" resolved to an empty image, omitting icon`);
      return undefined;
    }
    return image;
  } catch (error) {
    if (isDev) logger.warn(`Failed to resolve SF Symbol "${sfSymbol}"`, error);
    return undefined;
  }
};

const convertItem = (
  item: NativeContextMenuItemTemplate,
  onItemClick: (id: string) => void,
  capabilities: MacMenuCapabilities,
  isFirstAtLevel: boolean,
): MenuItemConstructorOptions | undefined => {
  if (item.type === 'separator') return { type: 'separator' };

  if (item.type === 'header') {
    if (capabilities.supportsHeader) return { label: item.label, type: 'header' };
    if (isFirstAtLevel) return undefined;
    return { type: 'separator' };
  }

  const icon = resolveMenuSymbolIcon(item.sfSymbol);
  const general: MenuItemConstructorOptions = {
    ...(item.enabled === false ? { enabled: false } : {}),
    ...(icon ? { icon } : {}),
    label: item.label,
    ...(capabilities.supportsSublabel && item.sublabel ? { sublabel: item.sublabel } : {}),
  };

  switch (item.type) {
    case 'normal': {
      return { ...general, ...(item.id ? { click: () => onItemClick(item.id!) } : {}) };
    }
    case 'checkbox': {
      return {
        ...general,
        checked: item.checked,
        type: 'checkbox',
        ...(item.id ? { click: () => onItemClick(item.id!) } : {}),
      };
    }
    case 'submenu': {
      return {
        ...general,
        submenu: convertItemsAtLevel(item.submenu ?? [], onItemClick, capabilities),
      };
    }
  }
};

const convertItemsAtLevel = (
  items: NativeContextMenuItemTemplate[],
  onItemClick: (id: string) => void,
  capabilities: MacMenuCapabilities,
): MenuItemConstructorOptions[] => {
  const result: MenuItemConstructorOptions[] = [];

  for (const item of items) {
    const converted = convertItem(item, onItemClick, capabilities, result.length === 0);
    if (converted) result.push(converted);
  }

  return result;
};

export const convertNativeContextMenuItems = (
  items: NativeContextMenuItemTemplate[],
  onItemClick: (id: string) => void,
): MenuItemConstructorOptions[] =>
  convertItemsAtLevel(items, onItemClick, getMacMenuCapabilities());

interface CurrentPopup {
  menu: Menu;
}

let currentPopup: CurrentPopup | null = null;

export const popupNativeContextMenu = (
  params: PopupContextMenuParams,
  window: BrowserWindow | null,
): Promise<PopupContextMenuResult> => {
  if (!window || window.isDestroyed()) return Promise.resolve({ clickedId: null });

  closeNativeContextMenuPopup();

  return new Promise<PopupContextMenuResult>((resolve) => {
    let resolved = false;

    const resolveOnce = (result: PopupContextMenuResult) => {
      if (resolved) return;
      resolved = true;
      if (currentPopup?.menu === menu) currentPopup = null;
      resolve(result);
    };

    const template = convertNativeContextMenuItems(params.items, (id) =>
      resolveOnce({ clickedId: id }),
    );
    const menu = Menu.buildFromTemplate(template);
    currentPopup = { menu };

    menu.popup({
      callback: () => {
        // Click-vs-close ordering isn't guaranteed across Electron versions/platforms, so defer this to let a real click win the resolve-once race.
        setTimeout(() => resolveOnce({ clickedId: null }), 0);
      },
      window,
    });
  });
};

export const closeNativeContextMenuPopup = (): void => {
  currentPopup?.menu.closePopup();
};
