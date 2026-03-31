import { Flexbox, Icon } from '@lobehub/ui';
import { DownloadIcon, MessageSquareIcon, StarIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

interface MetaInfoProps {
  className?: string;
  commentCount?: number;
  installCount?: number;
  stars?: number;
  style?: CSSProperties;
}

const MetaInfo = memo<MetaInfoProps>(({ style, stars, installCount, commentCount, className }) => {
  return (
    <Flexbox horizontal align={'center'} className={className} gap={8} style={style}>
      {Boolean(installCount) && (
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon icon={DownloadIcon} size={14} />
          {installCount}
        </Flexbox>
      )}
      {Boolean(stars) && (
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon icon={StarIcon} size={14} />
          {stars}
        </Flexbox>
      )}
      {Boolean(commentCount) && (
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon icon={MessageSquareIcon} size={14} />
          {commentCount}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default MetaInfo;
