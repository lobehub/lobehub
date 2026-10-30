import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import LazyLoad from 'react-lazy-load';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useServerConfigStore } from '@/store/serverConfig';

import ListItem from './ListItem';
import { useListNavigation } from './useListNavigation';

const styles = stylex.create({ container: { minHeight: '70px' }, link: { display: 'block' } });

interface AgentSearchListProps {
  dataSource?: SidebarAgentItem[];
}

export const AgentSearchList = memo<AgentSearchListProps>(({ dataSource }) => {
  const { t } = useTranslation('chat');
  const onNavigate = useListNavigation('search');
  const isMobile = useServerConfigStore((s) => s.isMobile);

  return dataSource?.map((item) => {
    const title = agentDisplayName(
      item,
      t(item.type === 'group' ? 'untitledGroup' : 'untitledAgent'),
    );

    return (
      <LazyLoad className={stylex.props(styles.container).className} key={item.id}>
        <WorkspaceLink
          aria-label={title}
          className={stylex.props(styles.link).className}
          to={item.type === 'group' ? GROUP_CHAT_URL(item.id) : AGENT_CHAT_URL(item.id, isMobile)}
          onClick={(event) => onNavigate(event, item)}
        >
          <ListItem
            agentId={item.id}
            avatar={item.avatar || DEFAULT_AVATAR}
            avatarBackground={item.backgroundColor || undefined}
            title={title}
            type={item.type}
            styles={{
              container: {
                gap: 12,
              },
              content: {
                gap: 6,
                maskImage: `linear-gradient(90deg, black 90%, transparent)`,
              },
            }}
          />
        </WorkspaceLink>
      </LazyLoad>
    );
  });
});

AgentSearchList.displayName = 'AgentSearchList';
