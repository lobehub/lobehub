import { Flexbox, Icon } from '@lobehub/ui';
import { DownloadIcon, StarIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { type DiscoverMcpItem } from '@/types/discover';

interface MetaInfoProps {
  className?: string;
  installCount: DiscoverMcpItem['installCount'];
  stars?: number;
  style?: CSSProperties;
}

const MetaInfo = memo<MetaInfoProps>(({ style, stars, installCount, className }) => {
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
    </Flexbox>
  );
});

export default MetaInfo;
