import { createStyles } from 'antd-style';
import React, { memo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/bases/${id}`);
  };

  return (
    <Flexbox
      align={'center'}
      className={cx(styles.container, knowledgeItemClass, active && styles.active)}
      distribution={'space-between'}
      horizontal
      onClick={handleClick}
      onMouseEnter={() => {
        setHovering(true);
      }}
      onMouseLeave={() => {
        setHovering(false);
      }}
      style={{ cursor: 'pointer' }}
    >
      <Content id={id} name={name} showMore={isHover} />
    </Flexbox>
  );
});

KnowledgeBaseItem.displayName = 'KnowledgeBaseItem';

export default KnowledgeBaseItem;
