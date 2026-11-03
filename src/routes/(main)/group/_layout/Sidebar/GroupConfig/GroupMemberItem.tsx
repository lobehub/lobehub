'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import NavItem from '@/features/NavPanel/components/NavItem';

interface GroupMemberItemProps {
  actions?: ReactNode;
  agentId?: string;
  avatar?: string;
  background?: string;
  isExternal?: boolean;
  onClick?: () => void;
  title: string;
}

const GroupMemberItem = memo<GroupMemberItemProps>(
  ({ title, agentId, avatar, background, actions, isExternal }) => {
    const { t } = useTranslation('chat');

    return (
      <NavItem
        actions={actions}
        icon={
          <AgentAvatar
            agentId={agentId}
            avatar={avatar}
            background={background}
            name={title}
            shape={'circle'}
            size={24}
            style={{ flex: 'none' }}
          />
        }
        title={
          <Flexbox horizontal align="center" gap={4}>
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
