import {
  closeContextMenu as closeWebContextMenu,
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
      const handler = result.clickedId ? handlers.get(result.clickedId) : undefined;
      handlers.clear();
      handler?.();
    })
    .catch((error) => {
      if (token !== popupToken) return;
      handlers.clear();
      log('popupContextMenu failed: %O', error);
    });
};

export const showContextMenu = (
  items: NativeContextMenuItem[],
  options?: ShowContextMenuOptions,
): void => {
  if (!isDarwinDesktop() || !canGoNative(items, options)) {
    activeMenu = 'web';
    showWebContextMenu(items, options);
    return;
  }

  const { template, handlers } = toNativeTemplate(items);

  if (template.length === 0) {
    activeMenu = 'web';
    showWebContextMenu(items, options);
    return;
  }

  runNativePopup(template, handlers);
};

export const closeContextMenu = (): void => {
  if (activeMenu === 'native') {
    void electronSystemService.closePopupContextMenu();
    return;
  }

  closeWebContextMenu();
};
