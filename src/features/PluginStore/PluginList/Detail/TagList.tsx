'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    tag: css`
      margin: 0;
      padding-block: 4px;
      padding-inline: 12px;
      border-radius: 16px;

      color: ${cssVar.colorTextSecondary};
    `,
  };
});

const TagList = memo<{ tags: string[] }>(({ tags }) => {
  const showTags = Boolean(tags?.length && tags?.length > 0);
  return (
    showTags && (
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        {tags.map((tag) => (
          <Tag className={styles.tag} key={tag}>
            {tag}
          </Tag>
        ))}
      </Flexbox>
    )
  );
});

export default TagList;
