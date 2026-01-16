'use client';

import { Avatar, Flexbox, Tag } from '@lobehub/ui';
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavItem from '@/features/NavPanel/components/NavItem';

interface GroupMemberItemProps {
  actions?: ReactNode;
  avatar?: string;
  background?: string;
  isExternal?: boolean;
  onClick?: () => void;
  title: string;
}

const GroupMemberItem = memo<GroupMemberItemProps>(
  ({ title, avatar, background, actions, isExternal }) => {
    const { t } = useTranslation('chat');

    return (
      <NavItem
        actions={actions}
        icon={
          <Avatar
            avatar={avatar || DEFAULT_AVATAR}
            background={background}
            emojiScaleWithBackground
            size={24}
            style={{ flex: 'none' }}
          />
        }
        title={
          <Flexbox align="center" gap={4} horizontal>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            {isExternal && (
              <Tag size="small" style={{ flexShrink: 0 }}>
                {t('group.profile.external')}
              </Tag>
            )}
          </Flexbox>
        }
      />
    );
  },
);

export default GroupMemberItem;
