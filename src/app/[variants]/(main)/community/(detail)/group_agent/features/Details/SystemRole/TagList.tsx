import { Tag as AntdTag, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

interface TagListProps {
  tags?: string[];
}

const TagList = memo<TagListProps>(({ tags = [] }) => {
  if (!tags || tags.length === 0) return null;

  return (
    <Flexbox gap={8} horizontal wrap={'wrap'}>
      {tags.map((tag, index) => (
        <AntdTag key={index}>{tag}</AntdTag>
      ))}
    </Flexbox>
  );
});

export default TagList;
