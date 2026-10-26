'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { cssVar, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import {
  CompassIcon,
  FolderKanbanIcon,
  LibraryBigIcon,
  ListTodoIcon,
  MessageCircleIcon,
  Settings2Icon,
  UsersRoundIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { isDesktop } from '@/const/version';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { MAC_VIBRANCY_BACKGROUND } from '@/features/Electron/system/macWindowFullscreen';
import User from '@/features/HomeSidebar/Header/components/User';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isMacOS } from '@/utils/platform';

import MoreMenu from './MoreMenu';
import RailItem from './RailItem';
import { resolveRailTab } from './railTab';
import { RAIL_GAP, styles } from './style';

// macOS Electron shows the window vibrancy through the rail, like the old sidebar.
const railBackground = {
  background: isDesktop && isMacOS() ? MAC_VIBRANCY_BACKGROUND : cssVar.colorBgLayout,
};

const useMessagesUnread = () =>
  useHomeStore((s) =>
    homeAgentListSelectors.allAgents(s).reduce((sum, item) => sum + (item.unreadCount ?? 0), 0),
  );

/**
 * Global icon rail (column ①). Tabs own a list column (column ②) registered
 * through `NavPanelPortal`, or render full-width inside the wrap.
 */
const NavRail = memo(() => {
  const { t } = useTranslation('common');
  const { pathname } = useActiveLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);
  const unread = useMessagesUnread();

  const activeTab = resolveRailTab(pathname, activeWorkspaceSlug);

  // Messages opens straight into the Lobe AI conversation, like an IM app's
  // default channel; the conversation list sits in the list column.
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const messagesUrl = AGENT_CHAT_URL(resolveInboxAgentRouteId(inboxAgentId), false);

  // Tab order follows the product IA: messages, contacts, docs, tasks, projects.
  const topItems = useMemo(
    () => [
      { icon: MessageCircleIcon, key: 'messages', title: t('tab.messages'), url: messagesUrl },
      { icon: UsersRoundIcon, key: 'contacts', title: t('tab.contacts'), url: '/agents' },
      { icon: LibraryBigIcon, key: 'resource', title: t('tab.resource'), url: '/resource' },
      { icon: ListTodoIcon, key: 'tasks', title: t('tab.tasks'), url: '/tasks' },
      { icon: FolderKanbanIcon, key: 'projects', title: t('tab.projects'), url: '/projects' },
    ],
    [messagesUrl, t],
  );

  return (
    <Flexbox className={stylex.props(styles.rail).className} gap={12} style={railBackground}>
      <User lite />
      <Flexbox align={'center'} gap={RAIL_GAP}>
        {topItems.map((item) => (
          <RailItem
            active={activeTab === item.key}
            badge={item.key === 'messages' ? unread : undefined}
            icon={item.icon}
            key={item.key}
            title={item.title}
            url={item.url}
          />
        ))}
      </Flexbox>
      <div style={{ flex: 1 }} />
      <Flexbox align={'center'} gap={RAIL_GAP}>
        <MoreMenu active={activeTab === 'more'} />
        {showMarket && (
          <RailItem
            active={activeTab === 'discover'}
            icon={CompassIcon}
            title={t('tab.discover')}
            url={'/community'}
          />
        )}
        <RailItem
          active={activeTab === 'settings'}
          icon={Settings2Icon}
          title={t('tab.setting')}
          url={'/settings'}
        />
      </Flexbox>
    </Flexbox>
  );
});

NavRail.displayName = 'NavRail';

export default NavRail;
