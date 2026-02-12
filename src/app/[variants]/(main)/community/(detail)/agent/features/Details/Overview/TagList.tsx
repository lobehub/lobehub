'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import qs from 'query-string';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { useQuery } from '@/hooks/useQuery';
import { type AssistantMarketSource } from '@/types/discover';

const styles = createStaticStyles(({ cssVar, css }) => {
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
  const { source } = useQuery() as { source?: AssistantMarketSource };
  const marketSource = source === 'legacy' ? 'legacy' : undefined;
  const showTags = Boolean(tags?.length && tags?.length > 0);
  return (
    showTags && (
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {tags.map((tag) => (
          <Link
            key={tag}
            to={qs.stringifyUrl(
              {
                query: {
                  q: tag,
                  source: marketSource,
                },
                url: '/community/agent',
              },
              { skipNull: true },
            )}
          >
            <Tag className={styles.tag}>{tag}</Tag>
          </Link>
        ))}
      </Flexbox>
    )
  );
});

export default TagList;
