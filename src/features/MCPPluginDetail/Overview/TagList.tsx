'use client';

import { createStaticStyles, Flexbox, Tag } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';

import { MARKETPLACE_MCP_PATH } from '@/features/Marketplace/paths';
import { Link } from '@/libs/router';
import { densityVars } from '@/styles/densityVars';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    tag: css`
      margin: 0;
      padding-block: 4px;
      padding-inline: ${densityVars.contentGap};
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
              url: MARKETPLACE_MCP_PATH,
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
