'use client';

import { Avatar, Block, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { itemStyles } from './style';

interface AgentItemProps {
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  identifier?: string;
  title?: string;
}

const AgentItem = memo<AgentItemProps>(
  ({ avatar, title, description, identifier, backgroundColor }) => {
    const styles = itemStyles;

    if (!identifier || !title) return null;

    return (
      <a
        href={`/community/agent/${identifier}`}
        rel="noopener noreferrer"
        style={{ display: 'block', height: '100%' }}
        target="_blank"
      >
        <Block
          clickable
          horizontal
          align={'center'}
          className={styles.container}
          gap={12}
          paddingBlock={12}
          paddingInline={12}
          style={{ cursor: 'pointer', height: '100%' }}
          variant={'outlined'}
        >
          <Avatar
            avatar={avatar}
            background={backgroundColor || 'transparent'}
            shape={'square'}
            size={40}
            style={{ flex: 'none' }}
          />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
            <span className={styles.title}>{title}</span>
            {description && <span className={styles.description}>{description}</span>}
          </Flexbox>
        </Block>
      </a>
    );
  },
);

export default AgentItem;
