'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
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
 * The project creator as a row of the members list, laid out like `MemberRow`.
 * A workspace project resolves its creator from the workspace members; a
 * personal project is always the signed-in user's.
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
    <Flexbox horizontal align="center" gap={12} paddingBlock={12} paddingInline={16}>
      <UserAvatar avatar={creator?.avatar} name={name} size={28} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Text ellipsis>{name}</Text>
        <Text ellipsis fontSize={12} type="secondary">
          {t('settings.createdAt', { date: dayjs(createdAt).format('YYYY-MM-DD') })}
        </Text>
      </Flexbox>
      <Tag>{t('settings.creator')}</Tag>
    </Flexbox>
  );
});

ProjectCreator.displayName = 'ProjectCreator';

export default ProjectCreator;
