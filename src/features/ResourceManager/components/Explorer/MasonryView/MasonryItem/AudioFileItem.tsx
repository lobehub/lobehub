import { Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AudioLinesIcon } from 'lucide-react';
import { memo } from 'react';

import { formatSize } from '@/utils/format';

const CONTROLS = '::-webkit-media-controls-panel';

const styles = stylex.create({
  cover: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingBlock: '28px',
    color: cssVar.colorTextSecondary,
    // subtle top highlight keeps the fill from reading flat
    backgroundImage: `radial-gradient(140% 100% at 50% 0%, color-mix(in srgb, #fff 8%, transparent) 0%, transparent 60%)`,
    backgroundColor: cssVar.colorFillQuaternary,
  },
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
  player: {
    width: '100%',
    height: '32px',
    backgroundColor: { default: null, [CONTROLS]: cssVar.colorFillQuaternary },
    backgroundImage: { default: null, [CONTROLS]: 'none' },
    backgroundPosition: { default: null, [CONTROLS]: '0% 0%' },
    backgroundSize: { default: null, [CONTROLS]: 'auto' },
    backgroundRepeat: { default: null, [CONTROLS]: 'repeat' },
    backgroundOrigin: { default: null, [CONTROLS]: 'padding-box' },
    backgroundClip: { default: null, [CONTROLS]: 'border-box' },
    backgroundAttachment: { default: null, [CONTROLS]: 'scroll' },
  },
});

interface AudioFileItemProps {
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

/** Masonry card for audio files: type cover plus an inline playable control. */
const AudioFileItem = memo<AudioFileItemProps>(({ isInView, name, size, url }) => (
  <>
    <div {...stylex.props(styles.cover)}>
      <Icon icon={AudioLinesIcon} size={40} />
    </div>
    <Flexbox className={stylex.props(styles.info).className} gap={8}>
      <span {...stylex.props(styles.name)}>{name}</span>
      <span {...stylex.props(styles.meta)}>{formatSize(size)}</span>
      {isInView && url && (
        // controls stay interactive without triggering the card's open action
        <audio
          controls
          {...stylex.props(styles.player)}
          preload={'metadata'}
          src={url}
          onClick={stopPropagation}
          onPointerDown={stopPropagation}
        />
      )}
    </Flexbox>
  </>
));

AudioFileItem.displayName = 'AudioFileItem';

export default AudioFileItem;
