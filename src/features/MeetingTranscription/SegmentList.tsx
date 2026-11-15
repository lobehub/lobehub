'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatOffset, speakerIndex } from './format';

export interface SegmentListItem {
  endMs: number;
  /** Stored row id; live segments fall back to their `seq`. */
  id?: string;
  seq: number;
  speaker?: string | null;
  startMs: number;
  text: string;
}

const SPEAKER_COLORS = [
  cssVar.colorPrimary,
  cssVar.colorSuccess,
  cssVar.colorWarning,
  cssVar.colorInfo,
  cssVar.colorError,
];

const styles = stylex.create({
  row: {
    paddingBlock: 6,
  },
  speaker: {
    fontSize: 12,
    fontWeight: 600,
  },
  text: {
    fontSize: 14,
    lineHeight: 1.7,
    color: cssVar.colorText,
    wordBreak: 'break-word',
  },
  time: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
});

interface SegmentListProps {
  /** Jump playback to a segment; makes its timestamp clickable. */
  onSeek?: (ms: number) => void;
  segments: SegmentListItem[];
  /** In-progress text after the last segment, shown muted. */
  tail?: string;
}

/** Timestamped transcript lines, with the speaker when diarization labelled one. */
const SegmentList = memo<SegmentListProps>(({ onSeek, segments, tail }) => {
  const { t } = useTranslation('meeting');

  return (
    <Flexbox gap={4}>
      {segments.map((segment) => {
        const index = speakerIndex(segment.speaker);
        const speaker =
          segment.speaker && (index ? t('transcript.speaker', { index }) : segment.speaker);
        return (
          <Flexbox
            className={stylex.props(styles.row).className}
            data-testid="meeting-segment"
            gap={2}
            key={segment.id ?? segment.seq}
          >
            <Flexbox horizontal align={'center'} gap={8}>
              {onSeek ? (
                <span
                  className={stylex.props(styles.time).className}
                  role={'button'}
                  style={{ cursor: 'pointer' }}
                  tabIndex={0}
                  onClick={() => onSeek(segment.startMs)}
                >
                  {formatOffset(segment.startMs)}
                </span>
              ) : (
                <span className={stylex.props(styles.time).className}>
                  {formatOffset(segment.startMs)}
                </span>
              )}
              {speaker && (
                <span
                  className={stylex.props(styles.speaker).className}
                  style={{ color: SPEAKER_COLORS[((index ?? 1) - 1) % SPEAKER_COLORS.length] }}
                >
                  {speaker}
                </span>
              )}
            </Flexbox>
            <span className={stylex.props(styles.text).className}>{segment.text}</span>
          </Flexbox>
        );
      })}
      {tail ? (
        <Text className={stylex.props(styles.text).className} type={'secondary'}>
          {tail}
        </Text>
      ) : null}
    </Flexbox>
  );
});

SegmentList.displayName = 'MeetingSegmentList';

export default SegmentList;
