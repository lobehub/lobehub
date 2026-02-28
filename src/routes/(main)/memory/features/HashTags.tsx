import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { HashIcon } from 'lucide-react';
import { memo } from 'react';

interface HashTagsProps {
  hashTags?: string[] | null;
}

const HashTags = memo<HashTagsProps>(({ hashTags }) => {
  if (!hashTags || hashTags.length === 0) return;
  return (
    hashTags &&
    hashTags.length > 0 && (
      <Flexbox horizontal wrap="wrap">
        {hashTags.map((tag, index) => (
          <Tag
            icon={<Icon icon={HashIcon} />}
            key={index}
            variant={'borderless'}
            style={{
              color: cssVar.colorTextDescription,
              gap: 2,
              marginRight: 12,
              paddingInline: 0,
            }}
          >
            {tag}
          </Tag>
        ))}
      </Flexbox>
    )
  );
});

export default HashTags;
