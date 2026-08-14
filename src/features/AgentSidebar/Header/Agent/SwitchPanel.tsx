import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import type { PropsWithChildren } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { type AgentRowRef, useHomeAgentRows } from '@/features/Home/AgentSelect/useHomeAgentRows';
import { resolvePreservedAgentUrl } from '@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl';
import { SidebarHeaderSelectPopover } from '@/features/NavPanel/SidebarHeaderSelect';
import type { SwitcherItem } from '@/features/NavPanel/switcher/switcherItems';
import SwitcherMenu from '@/features/NavPanel/switcher/SwitcherMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import {
  homeSidebarSelectors,
  useHomeSidebarProjection,
} from '@/projection/modules/home/sidebarHooks';
import { useAgentStore } from '@/store/agent';
import { useAgentMeta } from '@/store/agent/projection';

const SwitchPanel = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation(['common', 'chat']);
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useActiveLocation();
  const { error, mutate } = useFetchAgentList();
  const sidebar = useHomeSidebarProjection((value) => value);
  const isInit = homeSidebarSelectors.isAgentListInit(sidebar);
  const activeId = useAgentStore((s) => s.activeAgentId);
  const { privateRows, workspaceRows } = useHomeAgentRows();
  const inboxId = workspaceRows.find((row) => row.source === 'builtin')?.id;
  const inboxMeta = useAgentMeta(inboxId ?? '');

  const items = useMemo<SwitcherItem[]>(() => {
    const toItem = (row: AgentRowRef, isPrivate = false): SwitcherItem | undefined => {
      const meta =
        row.source === 'builtin' ? inboxMeta : homeSidebarSelectors.getAgentById(row.id)(sidebar);
      if (row.source === 'entity' && !meta) return undefined;

      return {
        avatar:
          (typeof meta?.avatar === 'string' ? meta.avatar : undefined) ??
          (row.source === 'builtin' ? DEFAULT_INBOX_AVATAR : undefined),
        background: meta?.backgroundColor || undefined,
        id: row.id,
        private: isPrivate,
        subtitle: agentSecondaryDisplayName(meta),
        title: agentDisplayName(
          meta,
          row.source === 'builtin' ? 'Lobe AI' : t('untitledAgent', { ns: 'chat' }),
        ),
      };
    };

    return [
      ...privateRows.map((row) => toItem(row, true)),
      ...workspaceRows.map((row) => toItem(row)),
    ].filter((item): item is SwitcherItem => Boolean(item));
  }, [inboxMeta, privateRows, sidebar, t, workspaceRows]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(resolvePreservedAgentUrl(pathname, id));
    },
    [navigate, pathname],
  );

  return (
    <SidebarHeaderSelectPopover
      content={
        <SwitcherMenu
          activeId={activeId}
          error={error}
          isLoading={!isInit && !error}
          items={items}
          kind={'agent'}
          searchPlaceholder={t('navPanel.searchAgent')}
          onRetry={() => mutate()}
          onSelect={handleSelect}
        />
      }
    >
      {children}
    </SidebarHeaderSelectPopover>
  );
});

SwitchPanel.displayName = 'SwitchPanel';

export default SwitchPanel;
