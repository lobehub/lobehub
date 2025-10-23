'use client';

import { Avatar, GroupAvatar } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { Suspense, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { usePinnedAgentState } from '@/hooks/usePinnedAgentState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useSessionStore } from '@/store/session';
import { sessionMetaSelectors, sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { GroupMemberWithAgent } from '@/types/session';

import TogglePanelButton from '../../../../features/TogglePanelButton';
import Tags from './Tags';

const useStyles = createStyles(({ css }) => ({
  container: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    max-width: 100%;
  `,
  tag: css`
    flex: none;
    align-items: baseline;
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: bold;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const Main = memo<{ className?: string }>(({ className }) => {
  const { t } = useTranslation(['chat', 'hotkey']);
  const { styles } = useStyles();
  useInitAgentConfig();
  const [isPinned] = usePinnedAgentState();

  const [init, isInbox, title, avatar, backgroundColor, members, sessionType] = useSessionStore(
    (s) => {
      const session = sessionSelectors.currentSession(s);

      return [
        sessionSelectors.isSomeSessionActive(s),
        sessionSelectors.isInboxSession(s),
        sessionMetaSelectors.currentAgentTitle(s),
        sessionMetaSelectors.currentAgentAvatar(s),
        sessionMetaSelectors.currentAgentBackgroundColor(s),
        session?.type === 'group' ? session.members : undefined,
        session?.type,
      ];
    },
  );

  const currentUser = useUserStore((s) => ({
    avatar: userProfileSelectors.userAvatar(s),
    name: userProfileSelectors.displayUserName(s) || userProfileSelectors.nickName(s) || 'You',
  }));

  const isGroup = sessionType === 'group';

  const openChatSettings = useOpenChatSettings();

  const displayTitle = isInbox ? t('inbox.title') : title;
  const showSessionPanel = useGlobalStore(systemStatusSelectors.showSessionPanel);

  if (!init)
    return (
      <Flexbox align={'center'} className={className} gap={8} horizontal>
        {!isPinned && !showSessionPanel && <TogglePanelButton />}
        <Skeleton
          active
          avatar={{ shape: 'circle', size: 28 }}
          paragraph={false}
          title={{ style: { margin: 0, marginTop: 4 }, width: 200 }}
        />
      </Flexbox>
    );

  if (isGroup) {
    return (
      <Flexbox align={'center'} className={className} gap={12} horizontal>
        {!isPinned && !showSessionPanel && <TogglePanelButton />}
        <GroupAvatar
          avatars={[
            {
              avatar: currentUser.avatar || DEFAULT_AVATAR,
            },
            ...(members?.map((member: GroupMemberWithAgent) => ({
              avatar: member.avatar || DEFAULT_AVATAR,
              background: member.backgroundColor || undefined,
            })) || []),
          ]}
          onClick={() => openChatSettings()}
          size={32}
          title={title}
        />
        <Flexbox align={'center'} className={styles.container} gap={8} horizontal>
          <div className={styles.title}>{displayTitle}</div>
          <Tags />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox align={'center'} className={className} gap={12} horizontal>
      {!isPinned && !showSessionPanel && <TogglePanelButton />}
      <Avatar
        avatar={avatar}
        background={backgroundColor}
        onClick={() => openChatSettings()}
        size={32}
        title={title}
      />
      <Flexbox align={'center'} className={styles.container} gap={8} horizontal>
        <div className={styles.title}>{displayTitle}</div>
        <Tags />
      </Flexbox>
    </Flexbox>
  );
});

export default memo<{ className?: string }>(({ className }) => (
  <Suspense
    fallback={
      <Skeleton
        active
        avatar={{ shape: 'circle', size: 'default' }}
        paragraph={false}
        title={{ style: { margin: 0, marginTop: 8 }, width: 200 }}
      />
    }
  >
    <Main className={className} />
  </Suspense>
));
