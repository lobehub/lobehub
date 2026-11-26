import { type DropdownItem, Icon } from '@lobehub/ui';
import { CheckIcon, PanelsTopLeftIcon, SquareTerminalIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { mcpEntryInstanceId, mcpEntryTabKey } from '@/features/MCPApp/entrypoints';
import { useMcpAppEntrypoints } from '@/features/MCPApp/useMcpAppEntrypoints';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';

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
  /** The conversation an app opened from the menu belongs to. */
  scope?: string;
  terminalAvailable: boolean;
  toggleTerminalPanel: (open: boolean) => void;
  /** The conversation an app opened from the menu runs in. */
  topicId?: string;
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
  scope,
  terminalAvailable,
  toggleTerminalPanel,
  topicId,
}: OpenMenuOptions) => {
  const { t } = useTranslation(['chat', 'setting', 'plugin']);
  const entries = useMcpAppEntrypoints(agentId, topicId);
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
      'tools',
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
              const key = mcpEntryTabKey(entry.identifier, entry.toolName, entry.linkId);
              return {
                key,
                label: entry.accountName ? `${entry.title} · ${entry.accountName}` : entry.title,
                icon: entry.icon ? (
                  <img alt={''} height={14} src={entry.icon} width={14} />
                ) : (
                  <Icon icon={PanelsTopLeftIcon} size={14} />
                ),
                onClick: () => {
                  if (scope) {
                    const id = mcpEntryInstanceId(scope, key);
                    const running = mcpAppSelectors.entry(id)(useMcpAppStore.getState());
                    // An app already open in its tab is shown, not opened again
                    // Loaded on the click: the tool-call stack stays out of the sidebar's first load
                    if (!openedTabs.includes(key) || !running || running.status === 'error')
                      void import('@/features/MCPApp/openEntrypoint').then(
                        ({ openMcpAppEntrypoint }) =>
                          openMcpAppEntrypoint({
                            agentId,
                            id,
                            identifier: entry.identifier,
                            linkId: entry.linkId,
                            toolName: entry.toolName,
                            topicId,
                          }),
                      );
                  }
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
    agentId,
    entries,
    mcpAppsAvailable,
    availableTabs,
    extraTabs,
    openBrowserTab,
    openTab,
    openedTabs,
    requestTabFocus,
    scope,
    t,
    terminalAvailable,
    toggleTerminalPanel,
    topicId,
  ]);
};
