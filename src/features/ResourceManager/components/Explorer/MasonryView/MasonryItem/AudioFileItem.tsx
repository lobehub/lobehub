import { Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AudioLinesIcon } from 'lucide-react';
import { memo } from 'react';

import { formatSize } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => ({
  cover: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    padding-block: 28px;

    color: ${cssVar.colorTextSecondary};

    /* subtle top highlight keeps the fill from reading flat */
    background:
      radial-gradient(
        140% 100% at 50% 0%,
        color-mix(in srgb, #fff 8%, transparent) 0%,
        transparent 60%
      ),
      ${cssVar.colorFillQuaternary};
  `,
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
  player: css`
    width: 100%;
    height: 32px;

    &::-webkit-media-controls-panel {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

interface AudioFileItemProps {
  isInView: boolean;
  name: string;
  size: number;
  url?: string;
}

/** Masonry card for audio files: type cover plus an inline playable control. */
const AudioFileItem = memo<AudioFileItemProps>(({ isInView, name, size, url }) => (
  <>
    <div className={styles.cover}>
      <Icon icon={AudioLinesIcon} size={40} />
    </div>
    <Flexbox className={styles.info} gap={8}>
      <span className={styles.name}>{name}</span>
      <span className={styles.meta}>{formatSize(size)}</span>
      {isInView && url && (
        // controls stay interactive without triggering the card's open action
        <audio
          controls
          className={styles.player}
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
