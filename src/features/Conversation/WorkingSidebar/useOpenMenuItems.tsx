import { type DropdownItem, Icon } from '@lobehub/ui';
import { CheckIcon, SquareTerminalIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { BROWSER_TAB_KEY, type SidebarTabDescriptor } from './dynamicTabs';

interface OpenMenuOptions {
  availableTabs: Map<string, SidebarTabDescriptor>;
  extraTabs: { key: string }[];
  openBrowserTab: () => string | undefined;
  openedTabs: string[];
  openTab: (key: string) => void;
  requestTabFocus: (key: string) => void;
  terminalAvailable: boolean;
  toggleTerminalPanel: (open: boolean) => void;
}
export const useOpenMenuItems = ({
  availableTabs,
  extraTabs,
  openBrowserTab,
  openTab,
  openedTabs,
  requestTabFocus,
  terminalAvailable,
  toggleTerminalPanel,
}: OpenMenuOptions) => {
  const { t } = useTranslation(['chat', 'setting']);
  return useCallback((): DropdownItem[] => {
    const itemOf = (key: string): DropdownItem | undefined => {
      const tab = availableTabs.get(key);
      if (!tab) return undefined;

      if (key === BROWSER_TAB_KEY) {
        return {
          icon: <Icon icon={tab.icon} size={14} />,
          key,
          label: tab.label,
          onClick: () => {
            const browserTab = openBrowserTab();
            if (browserTab) requestTabFocus(browserTab);
          },
        };
      }

      return {
        icon: <Icon icon={openedTabs.includes(key) ? CheckIcon : tab.icon} size={14} />,
        key,
        label: tab.label,
        onClick: () => {
          openTab(key);
          requestTabFocus(key);
        },
      };
    };
    const groupLabel = (label: string) => <span style={{ textTransform: 'none' }}>{label}</span>;
    const group = (key: string, label: string, keys: string[]): DropdownItem | undefined => {
      const children = keys.map(itemOf).filter((item): item is DropdownItem => Boolean(item));
      return children.length
        ? { children, key, label: groupLabel(label), type: 'group' }
        : undefined;
    };

    const workspaceGroup = group('workspace', t('workingPanel.openMenu.workspace'), [
      'search',
      'review',
      'pr',
      'files',
      'works',
      'comments',
      'skills',
      'documents',
      'web',
      ...extraTabs.map((tab) => tab.key),
    ]);
    const toolChildren = [itemOf('browser')].filter((item): item is DropdownItem => Boolean(item));
    if (terminalAvailable) {
      toolChildren.push({
        icon: <Icon icon={SquareTerminalIcon} size={14} />,
        key: 'terminal',
        label: t('workingPanel.openMenu.terminal'),
        onClick: () => toggleTerminalPanel(true),
      });
    }
    const toolGroup = toolChildren.length
      ? {
          children: toolChildren,
          key: 'tools',
          label: groupLabel(t('workingPanel.openMenu.tools')),
          type: 'group' as const,
        }
      : undefined;
    const configurationGroup = group('configuration', t('workingPanel.openMenu.configuration'), [
      'params',
    ]);

    return [workspaceGroup, toolGroup, configurationGroup]
      .filter((item): item is DropdownItem => Boolean(item))
      .flatMap((item, index, items) =>
        index < items.length - 1 ? [item, { type: 'divider' as const }] : [item],
      );
  }, [
    availableTabs,
    extraTabs,
    openBrowserTab,
    openTab,
    openedTabs,
    requestTabFocus,
    t,
    terminalAvailable,
    toggleTerminalPanel,
  ]);
};
