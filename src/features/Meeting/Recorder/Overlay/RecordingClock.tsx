import { Text } from '@lobehub/ui';

import { useMeetingStore } from '@/store/meeting';

import { formatClock } from '../../format';

/** Recorded time, paused time excluded. Its own subscriber, so only it ticks. */
const RecordingClock = ({ fontSize = 28 }: { fontSize?: number }) => {
  const durationMs = useMeetingStore((s) => s.recorder.durationMs);

  return (
    <Text
      fontSize={fontSize}
      style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}
      weight={600}
    >
      {formatClock(durationMs)}
    </Text>
  );
};

export default RecordingClock;
