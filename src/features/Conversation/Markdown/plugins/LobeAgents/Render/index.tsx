'use client';

import { SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { type MarkdownElementProps } from '../../type';

const styles = createStaticStyles(({ css, cssVar }) => ({
  arrowIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  card: css`
    cursor: pointer;

    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
  `,
}));

interface LobeAgentsProps extends MarkdownElementProps {
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  identifier: string;
  title: string;
}

const Render = memo<LobeAgentsProps>(
  ({ identifier, title, description, avatar, backgroundColor }) => {
    const navigate = useNavigate();

    const handleClick = useCallback(() => {
      if (!identifier) return;
      navigate(SESSION_CHAT_URL(identifier));
    }, [navigate, identifier]);

    if (!identifier) return null;

    return (
      <Flexbox
        align={'center'}
        className={styles.card}
        gap={12}
        horizontal
        onClick={handleClick}
      >
        <Avatar
          avatar={avatar || '🤖'}
          background={backgroundColor}
          shape={'square'}
          size={36}
          title={title || undefined}
        />
        <Flexbox flex={1} gap={2}>
          <span className={styles.title}>{title || identifier}</span>
          {description && <span className={styles.description}>{description}</span>}
        </Flexbox>
        <ArrowRight className={styles.arrowIcon} size={16} />
      </Flexbox>
    );
  },
);

Render.displayName = 'LobeAgentsRender';

export default Render;
