import {} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSyncExternalStore } from 'react';

import { meetingRecorder } from '../meetingRecorder';

const styles = stylex.create({
  bar: {
    transformOrigin: 'center',
    flex: '1',
    minWidth: 2,
    height: '100%',
    borderRadius: 2,
    backgroundColor: cssVar.colorPrimary,
    transition: {
      'default': 'transform 180ms ease-out',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  paused: {
    backgroundColor: cssVar.colorTextQuaternary,
  },
  root: {
    display: 'flex',
    gap: 2,
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
});

const subscribe = (listener: () => void) => meetingRecorder.levels.subscribe(listener);
const getLevels = () => meetingRecorder.levels.levels;

/** Speech sits around 0.02–0.2 RMS; a square root spreads it across the bar height. */
const toScale = (level: number) => Math.max(0.06, Math.min(1, Math.sqrt(level) * 2.2));

interface WaveformProps {
  /** Show only the newest `bars` levels (the minimized chip has room for a few). */
  bars?: number;
  height: number;
  paused?: boolean;
}

/** Recent input levels as scrolling bars, newest on the right. */
const Waveform = ({ bars, height, paused }: WaveformProps) => {
  const history = useSyncExternalStore(subscribe, getLevels, getLevels);
  const levels = bars ? history.slice(-bars) : history;

  return (
    <div aria-hidden className={stylex.props(styles.root).className} style={{ height }}>
      {levels.map((level, index) => (
        <span
          className={stylex.props(styles.bar, paused && styles.paused).className}
          key={index}
          style={{ transform: `scaleY(${toScale(level)})` }}
        />
      ))}
    </div>
  );
};

export default Waveform;
