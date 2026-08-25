import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PlayIcon } from 'lucide-react';
import { memo } from 'react';

import { formatSize } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => ({
  info: css`
    padding: 12px;
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  name: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  playBadge: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: grid;
    place-items: center;

    width: 44px;
    height: 44px;
    border-radius: 50%;

    color: #fff;

    background: color-mix(in srgb, #000 45%, transparent);
    backdrop-filter: blur(4px);
  `,
  videoWrapper: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    min-height: 120px;

    background: ${cssVar.colorFillQuaternary};

    video {
      pointer-events: none;
      display: block;
      width: 100%;
      height: auto;
    }
  `,
}));

interface VideoFileItemProps {
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

/** Masonry card for video files: a real first-frame preview with a play badge. */
const VideoFileItem = memo<VideoFileItemProps>(({ isInView, name, size, url }) => (
  <>
    <div className={styles.videoWrapper}>
      {isInView && url && (
        // The #t=0.001 media fragment forces a seek so the browser actually
        // paints the first frame; bare preload="metadata" may stay blank.
        <video muted playsInline preload={'metadata'} src={`${url}#t=0.001`} />
      )}
      <div className={styles.playBadge}>
        <Icon icon={PlayIcon} size={20} />
      </div>
    </div>
    <Flexbox className={styles.info} gap={4}>
      <span className={styles.name}>{name}</span>
      <span className={styles.meta}>{formatSize(size)}</span>
    </Flexbox>
  </>
));

VideoFileItem.displayName = 'VideoFileItem';

export default VideoFileItem;
