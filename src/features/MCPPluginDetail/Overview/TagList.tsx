'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import qs from 'query-string';
import { memo } from 'react';

import { Link } from '@/libs/router';

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
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {tags.map((tag) => (
          <Link
            key={tag}
            href={qs.stringifyUrl({
              query: {
                q: tag,
              },
              url: '/community/mcp',
            })}
          >
            <Tag className={styles.tag}>{tag}</Tag>
          </Link>
        ))}
      </Flexbox>
    )
  );
});

export default TagList;
