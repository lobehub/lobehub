import { ActionIcon, Block } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { MaximizeIcon, MinimizeIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { type QueryTagsResult } from '@/database/models/userMemory';
import dynamic from '@/libs/next/dynamic';

const TagCloudCanvas = dynamic(() => import('./TagCloudCanvas'), {
  loading: () => <SkeletonBar height={400} radius={12} />,
  ssr: false,
});

const styles = createStaticStyles(({ css }) => ({
  fullscreen: css`
    position: absolute;
    z-index: 10;
    inset: 0;

    width: 100%;
    height: 100%;
    border-radius: 0;
  `,
  fullscreenAnimation: css`
    opacity: 0;
  `,
  icon: css`
    position: absolute;
    z-index: 10;
    inset-block-start: 6px;
    inset-inline-end: 6px;
  `,
  root: css`
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 400px;

    .fullscreen-icon {
      opacity: 0;
    }

    &:hover {
      .fullscreen-icon {
        opacity: 1;
      }
    }
  `,
}));

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
      className={cx(
        styles.root,
        fullscreen && styles.fullscreen,
        fullscreenAnimation && styles.fullscreenAnimation,
      )}
    >
      <ActionIcon
        className={cx('fullscreen-icon', styles.icon)}
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
