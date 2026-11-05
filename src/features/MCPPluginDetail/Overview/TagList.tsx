'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import qs from 'query-string';
import { memo } from 'react';

import { Link } from '@/libs/router';

const styles = stylex.create({
  tag: {
    margin: '0',
    paddingBlock: '4px',
    paddingInline: '12px',
    borderRadius: '16px',
    color: cssVar.colorTextSecondary,
  },
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
            <Tag className={stylex.props(styles.tag).className}>{tag}</Tag>
          </Link>
        ))}
      </Flexbox>
    )
  );
});

export default TagList;
