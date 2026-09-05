'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { type CSSProperties, memo } from 'react';

interface ArticleSkeletonProps {
  avatar?: boolean | number;
  className?: string;
  rows?: number;
  style?: CSSProperties;
  title?: boolean | number | string;
}

const ArticleSkeleton = memo<ArticleSkeletonProps>(
  ({ avatar = false, className, rows = 3, style, title = true }) => {
    const body = (
      <Flexbox gap={16} width={'100%'}>
        {title !== false && <Skeleton.Text width={title === true ? '60%' : title} />}
        {rows > 0 && <Skeleton.Text rows={rows} />}
      </Flexbox>
    );

    if (!avatar)
      return (
        <Flexbox className={className} style={style} width={'100%'}>
          {body}
        </Flexbox>
      );

    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        className={className}
        gap={16}
        style={style}
        width={'100%'}
      >
        <Skeleton.Avatar size={avatar === true ? 40 : avatar} />
        {body}
      </Flexbox>
    );
  },
);

ArticleSkeleton.displayName = 'ArticleSkeleton';

export default ArticleSkeleton;
