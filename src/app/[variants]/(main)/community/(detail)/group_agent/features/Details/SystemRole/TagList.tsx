import { Flexbox,Tag as AntdTag } from '@lobehub/ui';
import { memo } from 'react';

interface TagListProps {
  tags?: string[];
}

const TagList = memo<TagListProps>(({ tags = [] }) => {
  if (!tags || tags.length === 0) return null;

  return (
    <Flexbox horizontal gap={8} wrap={'wrap'}>
      {tags.map((tag, index) => (
        <AntdTag key={index}>{tag}</AntdTag>
      ))}
    </Flexbox>
  );
});

export default TagList;
