import type { SFSymbol } from '@lobechat/electron-client-ipc';
import { PinIcon, PinOffIcon, XIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

import { isDynamicTab } from './dynamicTabs';

interface UseTabContextMenuItemsOptions {
  closeTab: (tab: string) => void;
  closeTabs: (tabs: string[], fallbackTab?: string) => void;
  openedTabs: string[];
  pinnedTabsSet: Set<string>;
  pinTab: (tab: string) => void;
  unpinTab: (tab: string) => void;
}

/** Builds the right-click menu (pin / close variants) of one working-sidebar tab. */
export const useTabContextMenuItems = ({
  closeTab,
  closeTabs,
  openedTabs,
  pinTab,
  pinnedTabsSet,
  unpinTab,
}: UseTabContextMenuItemsOptions) => {
  const { t } = useTranslation('chat');

  return useCallback(
    (tab: string, index: number): NativeContextMenuItem[] => {
      const pinned = pinnedTabsSet.has(tab);
      const leftTabs = openedTabs.slice(0, index);
      const rightTabs = openedTabs.slice(index + 1);
      const otherTabs = openedTabs.filter((item) => item !== tab);
      const hasClosable = (tabs: string[]) => tabs.some((item) => !pinnedTabsSet.has(item));

      return [
        ...(!isDynamicTab(tab)
          ? [
              {
                icon: pinned ? PinOffIcon : PinIcon,
                key: pinned ? 'unpin' : 'pin',
                label: t(pinned ? 'workingPanel.tabs.unpin' : 'workingPanel.tabs.pin'),
                onClick: () => (pinned ? unpinTab(tab) : pinTab(tab)),
                sfSymbol: (pinned ? 'pin.slash' : 'pin') satisfies SFSymbol,
              } as NativeContextMenuItem,
              { type: 'divider' as const },
            ]
          : []),
        {
          disabled: pinned,
          icon: XIcon,
          key: 'close',
          label: t('workingPanel.tabs.close'),
          onClick: () => closeTab(tab),
        },
        {
          disabled: !hasClosable(otherTabs),
          key: 'closeOthers',
          label: t('workingPanel.tabs.closeOthers'),
          onClick: () => closeTabs(otherTabs, tab),
        },
        { type: 'divider' },
        {
          disabled: !hasClosable(leftTabs),
          key: 'closeLeft',
          label: t('workingPanel.tabs.closeLeft'),
          onClick: () => closeTabs(leftTabs, tab),
        },
        {
          disabled: !hasClosable(rightTabs),
          key: 'closeRight',
          label: t('workingPanel.tabs.closeRight'),
          onClick: () => closeTabs(rightTabs, tab),
        },
      ];
    },
    [closeTab, closeTabs, openedTabs, pinTab, pinnedTabsSet, t, unpinTab],
  );
};
