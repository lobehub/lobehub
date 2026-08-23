import type { PropsWithChildren } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeAgentRows } from '@/features/Home/AgentSelect/useHomeAgentRows';
import { resolvePreservedAgentUrl } from '@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl';
import { SidebarHeaderSelectPopover } from '@/features/NavPanel/SidebarHeaderSelect';
import type { SwitcherItem } from '@/features/NavPanel/switcher/switcherItems';
import SwitcherMenu from '@/features/NavPanel/switcher/SwitcherMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

const SwitchPanel = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useActiveLocation();
  const { error, mutate } = useFetchAgentList();
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const activeId = useAgentStore((s) => s.activeAgentId);
  const { privateRows, workspaceRows } = useHomeAgentRows();

  const items = useMemo<SwitcherItem[]>(
    () => [
      ...privateRows.map((row) => ({
        avatar: row.avatar,
        background: row.backgroundColor,
        id: row.id,
        private: true,
        subtitle: row.subtitle,
        title: row.title,
      })),
      ...workspaceRows.map((row) => ({
        avatar: row.avatar,
        background: row.backgroundColor,
        id: row.id,
        subtitle: row.subtitle,
        title: row.title,
      })),
    ],
    [privateRows, workspaceRows],
  );

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
