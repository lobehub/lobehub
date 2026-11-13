'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import qs from 'query-string';
import { memo } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { type AssistantMarketSource } from '@/types/discover';

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
  const { source } = useQuery() as { source?: AssistantMarketSource };
  const marketSource = source === 'legacy' ? 'legacy' : undefined;
  const showTags = Boolean(tags?.length && tags?.length > 0);
  return (
    showTags && (
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {tags.map((tag) => (
          <WorkspaceLink
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
            <Tag className={stylex.props(styles.tag).className}>{tag}</Tag>
          </WorkspaceLink>
        ))}
      </Flexbox>
    )
  );
});

export default TagList;
