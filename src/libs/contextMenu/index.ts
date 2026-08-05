import {
  closeContextMenu as closeWebContextMenu,
  setContextMenuInterceptor,
  showContextMenu as showWebContextMenu,
} from '@lobehub/ui';
import debug from 'debug';

import { electronSystemService } from '@/services/electron/system';

import { canGoNative } from './canGoNative';
import { isDarwinDesktop } from './platform';
import { toNativeTemplate } from './toNativeTemplate';
import type { NativeContextMenuItem, ShowContextMenuOptions } from './types';

const log = debug('lobe-client:context-menu');

let popupToken = 0;
let activeMenu: 'native' | 'web' | null = null;

const runNativePopup = (
  template: ReturnType<typeof toNativeTemplate>['template'],
  handlers: Map<string, () => void>,
) => {
  const token = ++popupToken;
  activeMenu = 'native';

  log('opening native context menu with %d item(s)', template.length);

  electronSystemService
    .popupContextMenu({ items: template })
    .then((result) => {
      if (token !== popupToken) return;
      activeMenu = null;
      const handler = result.clickedId ? handlers.get(result.clickedId) : undefined;
      handlers.clear();
      handler?.();
    })
    .catch((error) => {
      if (token !== popupToken) return;
      activeMenu = null;
      handlers.clear();
      log('popupContextMenu failed: %O', error);
    });
};

const routeShow = (
  items: NativeContextMenuItem[],
  options: ShowContextMenuOptions | undefined,
  showWeb: () => void,
) => {
  if (!isDarwinDesktop() || !canGoNative(items, options)) {
    activeMenu = 'web';
    showWeb();
    return;
  }

  const { template, handlers } = toNativeTemplate(items);

  if (template.length === 0) {
    activeMenu = 'web';
    showWeb();
    return;
  }

  runNativePopup(template, handlers);
};

const routeClose = (closeWeb: () => void) => {
  if (activeMenu === 'native') {
    activeMenu = null;
    void electronSystemService.closePopupContextMenu();
    return;
  }

  closeWeb();
};

export const showContextMenu = (
  items: NativeContextMenuItem[],
  options?: ShowContextMenuOptions,
): void => {
  routeShow(items, options, () => showWebContextMenu(items, options));
};

export const closeContextMenu = (): void => {
  routeClose(closeWebContextMenu);
};

export const registerNativeContextMenuInterceptor = (): void => {
  setContextMenuInterceptor({
    close: routeClose,
    show: routeShow,
  });
};
