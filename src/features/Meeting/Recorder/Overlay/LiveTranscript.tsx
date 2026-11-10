import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useMeetingStore } from '@/store/meeting';

import { formatClock } from '../../format';

const styles = stylex.create({
  hint: {
    fontSize: 12,
    color: cssVar.colorTextTertiary,
  },
  status: {
    fontSize: 12,
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
    textAlign: 'end',
  },
  scroll: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    height: 168,
    paddingBlock: 12,
    paddingInline: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  segment: {
    fontSize: 13,
    lineHeight: 1.6,
    color: cssVar.colorText,
    wordBreak: 'break-word',
  },
  time: {
    marginInlineEnd: 6,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
});

/** The live draft while recording, following the newest line. */
const LiveTranscript = () => {
  const { t } = useTranslation('meeting');
  const segments = useMeetingStore((s) => s.recorder.segments);
  const live = useMeetingStore((s) => s.recorder.live);
  const pendingWindows = useMeetingStore((s) => s.recorder.pendingWindows);
  const paused = useMeetingStore((s) => s.recorder.phase === 'paused');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [segments.length]);

  const status =
    live === 'unavailable'
      ? t('live.unavailable')
      : live === 'offline'
        ? t('live.offline')
        : live === 'lagging'
          ? t('live.lagging')
          : paused
            ? t('live.paused')
            : pendingWindows > 0
              ? t('live.pending')
              : undefined;

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
        <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'} weight={500}>
          {t('live.title')}
        </Text>
        {status && <span className={stylex.props(styles.status).className}>{status}</span>}
      </Flexbox>
      <div aria-live={'polite'} className={stylex.props(styles.scroll).className} ref={scrollRef}>
        {segments.length === 0 ? (
          <span className={stylex.props(styles.hint).className}>
            {live === 'unavailable' ? t('live.unavailable') : t('live.empty')}
          </span>
        ) : (
          segments.map((segment) => (
            <div className={stylex.props(styles.segment).className} key={segment.seq}>
              <span className={stylex.props(styles.time).className}>
                {formatClock(segment.startMs)}
              </span>
              {segment.text}
            </div>
          ))
        )}
      </div>
    </Flexbox>
  );
};

export default LiveTranscript;
