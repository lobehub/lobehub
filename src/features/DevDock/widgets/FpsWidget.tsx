'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useState } from 'react';

const styles = stylex.create({
  low: { color: cssVar.colorError },
  mid: { color: cssVar.colorWarning },
  text: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    color: cssVar.colorTextTertiary,
  },
});

const FpsWidget = memo(() => {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();

    const loop = (now: number) => {
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (fps === null) return null;

  return (
    <span
      {...stylex.props(styles.text, fps < 30 ? styles.low : fps < 50 ? styles.mid : undefined)}
      title={'Frames per second'}
    >
      {fps} FPS
    </span>
  );
});

FpsWidget.displayName = 'DevDockFpsWidget';

export default FpsWidget;
