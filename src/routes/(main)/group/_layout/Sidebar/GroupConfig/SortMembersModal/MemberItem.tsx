'use client';

import { createStaticStyles, SortableList, Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

const styles = createStaticStyles(({ css }) => ({
  title: css`
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface MemberItemProps {
  agentId?: string;
  avatar?: string;
  background?: string;
  disabled?: boolean;
  isExternal?: boolean;
  title: string;
}

const MemberItem = memo<MemberItemProps>(
  ({ agentId, avatar, background, disabled, isExternal, title }) => {
    const { t } = useTranslation('chat');

    return (
      <>
        {!disabled && <SortableList.DragHandle />}
        <AgentAvatar
          agentId={agentId}
          avatar={avatar}
          background={background}
          name={title}
          shape={'circle'}
          size={24}
          style={{ flex: 'none' }}
        />
        <span className={styles.title}>{title}</span>
        {isExternal && (
          <Tag size={'small'} style={{ flexShrink: 0 }}>
            {t('group.profile.external')}
          </Tag>
        )}
      </>
    );
  },
);

export default MemberItem;
