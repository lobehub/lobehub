import { ActionIcon, Block } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MaximizeIcon, MinimizeIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { type QueryTagsResult } from '@/database/models/userMemory';
import dynamic from '@/libs/next/dynamic';

import { roleTagCloudMarker } from './markers.stylex';

const TagCloudCanvas = dynamic(() => import('./TagCloudCanvas'), {
  loading: () => <SkeletonBar height={400} radius={12} />,
  ssr: false,
});

const styles = stylex.create({
  fullscreen: {
    position: 'absolute',
    zIndex: 10,
    inset: 0,
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },
  fullscreenAnimation: { opacity: 0 },
  icon: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '6px',
    insetInlineEnd: '6px',
    opacity: { default: 0, [stylex.when.ancestor(':hover', roleTagCloudMarker)]: 1 },
  },
  root: { position: 'relative', overflow: 'hidden', width: '100%', height: '400px' },
});

interface RoleTagCloudProps {
  tags: QueryTagsResult[];
}

const RoleTagCloud = memo<RoleTagCloudProps>(({ tags }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAnimation, setFullscreenAnimation] = useState(false);

  useEffect(() => {
    setFullscreenAnimation(true);
    setTimeout(() => {
      setFullscreenAnimation(false);
    }, 500);
  }, [fullscreen]);

  if (!tags.length) return null;
  return (
    <Block
      variant={fullscreen ? 'borderless' : 'outlined'}
      className={
        stylex.props(
          roleTagCloudMarker,
          styles.root,
          fullscreen && styles.fullscreen,
          fullscreenAnimation && styles.fullscreenAnimation,
        ).className
      }
    >
      <ActionIcon
        className={stylex.props(styles.icon).className}
        icon={fullscreen ? MinimizeIcon : MaximizeIcon}
        size={DESKTOP_HEADER_ICON_SIZE}
        onClick={() => {
          setFullscreen(!fullscreen);
        }}
      />
      <TagCloudCanvas tags={tags} />
    </Block>
  );
});

export default RoleTagCloud;
