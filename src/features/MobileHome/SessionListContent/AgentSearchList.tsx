import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import LazyLoad from 'react-lazy-load';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useServerConfigStore } from '@/store/serverConfig';

import ListItem from './ListItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    min-height: 70px;
  `,
  link: css`
    display: block;
  `,
}));

interface AgentSearchListProps {
  dataSource?: SidebarAgentItem[];
}

export const AgentSearchList = memo<AgentSearchListProps>(({ dataSource }) => {
  const { t } = useTranslation('chat');
  const isMobile = useServerConfigStore((s) => s.isMobile);

  return dataSource?.map((item) => {
    const title = agentDisplayName(item, t('untitledAgent'));

    return (
      <LazyLoad className={styles.container} key={item.id}>
        <WorkspaceLink
          aria-label={title}
          className={styles.link}
          to={item.type === 'group' ? GROUP_CHAT_URL(item.id) : AGENT_CHAT_URL(item.id, isMobile)}
        >
          <ListItem
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
                maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
              },
            }}
          />
        </WorkspaceLink>
      </LazyLoad>
    );
  });
});

AgentSearchList.displayName = 'AgentSearchList';
