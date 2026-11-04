'use client';

import { Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import UserAvatar from '@/components/UserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export interface ProjectCreatorProps {
  createdAt: Date | string;
  userId: string;
}

/**
 * Who created the project, and when. A workspace project resolves its creator
 * from the workspace members; a personal project is always the signed-in user's.
 */
const ProjectCreator = memo<ProjectCreatorProps>(({ createdAt, userId }) => {
  const { t } = useTranslation('project');
  const hasActiveWorkspace = useHasActiveWorkspace();
  const member = useAuthorInfo(userId);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const currentUserName = useUserStore(userProfileSelectors.displayUserName);
  const currentUserAvatar = useUserStore(userProfileSelectors.userAvatar);
  const creator =
    !hasActiveWorkspace || userId === currentUserId
      ? { avatar: currentUserAvatar, fullName: currentUserName }
      : member;
  // A creator who has left the workspace no longer resolves to a member.
  const name = creator?.fullName || t('settings.creatorUnknown');

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <UserAvatar avatar={creator?.avatar} name={name} shape={'circle'} size={24} />
      <Text weight={500}>{name}</Text>
      <Text type={'secondary'}>
        {t('settings.createdAt', { date: dayjs(createdAt).format('YYYY-MM-DD') })}
      </Text>
    </Flexbox>
  );
});

ProjectCreator.displayName = 'ProjectCreator';

export default ProjectCreator;
