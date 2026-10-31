import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlayIcon } from 'lucide-react';
import { memo } from 'react';

import { formatSize } from '@/utils/format';

const styles = stylex.create({
  info: {
    padding: '12px',
  },
  meta: {
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  name: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: cssVar.fontWeightStrong,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  playBadge: {
    position: 'absolute',
    zIndex: 1,
    insetBlockStart: '50%',
    insetInlineStart: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'grid',
    placeItems: 'center',
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    color: '#fff',
    backgroundColor: 'color-mix(in srgb, #000 45%, transparent)',
    backgroundImage: 'none',
    backdropFilter: 'blur(4px)',
  },
  video: {
    pointerEvents: 'none',
    display: 'block',
    width: '100%',
    height: 'auto',
  },
  videoWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: '120px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

interface VideoFileItemProps {
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

/** Masonry card for video files: a real first-frame preview with a play badge. */
const VideoFileItem = memo<VideoFileItemProps>(({ isInView, name, size, url }) => (
  <>
    <div {...stylex.props(styles.videoWrapper)}>
      {isInView && url && (
        // The #t=0.001 media fragment forces a seek so the browser actually
        // paints the first frame; bare preload="metadata" may stay blank.
        <video
          muted
          playsInline
          preload={'metadata'}
          src={`${url}#t=0.001`}
          {...stylex.props(styles.video)}
        />
      )}
      <div {...stylex.props(styles.playBadge)}>
        <Icon icon={PlayIcon} size={20} />
      </div>
    </div>
    <Flexbox className={stylex.props(styles.info).className} gap={4}>
      <span {...stylex.props(styles.name)}>{name}</span>
      <span {...stylex.props(styles.meta)}>{formatSize(size)}</span>
    </Flexbox>
  </>
));

VideoFileItem.displayName = 'VideoFileItem';

export default VideoFileItem;
