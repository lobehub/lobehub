import { createStyles } from 'antd-style';
import Link from 'next/link';
import React, { memo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useQueryRoute } from '@/hooks/useQueryRoute';

import Content, { knowledgeItemClass } from './Content';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  active: css`
    background: ${isDarkMode ? token.colorFillSecondary : token.colorFillTertiary};
    transition: background 200ms ${token.motionEaseOut};

    &:hover {
      background: ${token.colorFill};
    }
  `,
  container: css`
    cursor: pointer;

    margin-inline: 8px;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${token.borderRadius}px;

    &.${knowledgeItemClass} {
      width: calc(100% - 16px);
    }

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  split: css`
    border-block-end: 1px solid ${token.colorSplit};
  `,
}));

export interface KnowledgeBaseItemProps {
  active?: boolean;
  id: string;
  name: string;
}

const KnowledgeBaseItem = memo<KnowledgeBaseItemProps>(({ name, active, id }) => {
  const { styles, cx } = useStyles();
  const [isHover, setHovering] = useState(false);
  const router = useQueryRoute();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    router.push(`/repos/${id}`);
  };

  return (
    <Link href={`/repos/${id}`} onClick={handleClick}>
      <Flexbox
        align={'center'}
        className={cx(styles.container, knowledgeItemClass, active && styles.active)}
        distribution={'space-between'}
        horizontal
        onMouseEnter={() => {
          setHovering(true);
        }}
        onMouseLeave={() => {
          setHovering(false);
        }}
      >
        <Content id={id} name={name} showMore={isHover} />
      </Flexbox>
    </Link>
  );
});

export default KnowledgeBaseItem;
