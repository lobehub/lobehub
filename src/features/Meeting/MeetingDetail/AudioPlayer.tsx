import { ActionIcon, Flexbox, Slider, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PauseIcon, PlayIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatClock } from '../format';
import type { Playback } from './usePlayback';

const styles = stylex.create({
  root: {
    paddingBlock: 8,
    paddingInlineStart: 8,
    paddingInlineEnd: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
  time: {
    flex: 'none',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
  },
});

interface AudioPlayerProps {
  /** Shown instead of the controls when there is nothing to play. */
  emptyHint?: string;
  playback: Playback;
  src?: string;
}

const AudioPlayer = ({ emptyHint, playback, src }: AudioPlayerProps) => {
  const { t } = useTranslation('meeting');
  const { audioRef, currentMs, durationMs, playing, seek, toggle } = playback;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={12}>
      <audio preload={'metadata'} ref={audioRef} src={src} />
      {src ? (
        <>
          <ActionIcon
            aria-label={playing ? t('recorder.pause') : t('recorder.resume')}
            data-testid={'meeting-audio-toggle'}
            icon={playing ? PauseIcon : PlayIcon}
            title={playing ? t('recorder.pause') : t('recorder.resume')}
            onClick={toggle}
          />
          <span className={stylex.props(styles.time).className}>{formatClock(currentMs)}</span>
          <Flexbox flex={1}>
            <Slider
              max={Math.max(durationMs, 1)}
              min={0}
              step={100}
              value={Math.min(currentMs, durationMs)}
              onChange={(value) => seek(value as number, { play: playing })}
            />
          </Flexbox>
          <span className={stylex.props(styles.time).className}>{formatClock(durationMs)}</span>
        </>
      ) : (
        <Text fontSize={13} style={{ paddingInlineStart: 8 }} type={'secondary'}>
          {emptyHint}
        </Text>
      )}
    </Flexbox>
  );
};

export default AudioPlayer;
