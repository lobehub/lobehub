import { type DropdownItem, Icon } from '@lobehub/ui';
import { CheckIcon, PanelsTopLeftIcon, SquareTerminalIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { mcpEntryTabKey } from '@/features/MCPApp/entrypoints';
import { useMcpAppEntrypoints } from '@/features/MCPApp/useMcpAppEntrypoints';

import { BROWSER_TAB_KEY, type SidebarTabDescriptor } from './dynamicTabs';

interface OpenMenuOptions {
  agentId?: string;
  availableTabs: Map<string, SidebarTabDescriptor>;
  extraTabs: { key: string }[];
  mcpAppsAvailable?: boolean;
  openBrowserTab: () => string | undefined;
  openedTabs: string[];
  openTab: (key: string) => void;
  requestTabFocus: (key: string) => void;
  terminalAvailable: boolean;
  toggleTerminalPanel: (open: boolean) => void;
}
export const useOpenMenuItems = ({
  availableTabs,
  agentId,
  mcpAppsAvailable,
  extraTabs,
  openBrowserTab,
  openTab,
  openedTabs,
  requestTabFocus,
  terminalAvailable,
  toggleTerminalPanel,
}: OpenMenuOptions) => {
  const { t } = useTranslation(['chat', 'setting', 'plugin']);
  const entries = useMcpAppEntrypoints(agentId);
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

    const appGroup: DropdownItem | undefined =
      mcpAppsAvailable && entries.length
        ? {
            type: 'group',
            key: 'mcp-apps',
            label: groupLabel(t('mcpApp.entrypoints', { ns: 'plugin' })),
            children: entries.map((entry) => {
              const key = mcpEntryTabKey(entry.identifier, entry.toolName);
              return {
                key,
                label: entry.title,
                icon: entry.icon ? (
                  <img alt={''} height={14} src={entry.icon} width={14} />
                ) : (
                  <Icon icon={PanelsTopLeftIcon} size={14} />
                ),
                onClick: () => {
                  openTab(key);
                  requestTabFocus(key);
                },
              };
            }),
          }
        : undefined;
    return [workspaceGroup, toolGroup, appGroup, configurationGroup]
      .filter((item): item is DropdownItem => Boolean(item))
      .flatMap((item, index, items) =>
        index < items.length - 1 ? [item, { type: 'divider' as const }] : [item],
      );
  }, [
    entries,
    mcpAppsAvailable,
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
