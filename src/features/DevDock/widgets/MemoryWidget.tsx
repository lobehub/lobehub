'use client';

import { Popover } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';

import { DOCK_Z_INDEX } from '../const';
import { barButtonStyles } from './BarButton';
import { formatCompactSize } from './memoryFormat';
import MemoryPopover from './MemoryPopover';
import { isMemorySamplingSupported, useMemorySamples } from './memorySamples';
import { isMemoryHigh } from './metricUtils';

const styles = stylex.create({
  active: {
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  high: { color: { 'default': cssVar.colorError, ':hover': cssVar.colorText } },
  mid: { color: { 'default': cssVar.colorWarning, ':hover': cssVar.colorText } },
  text: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
  },
});

const MemoryWidget = memo(() => {
  const samples = useMemorySamples();
  const [open, setOpen] = useState(false);

  if (!isMemorySamplingSupported() || !samples) return null;

  const { jsHeapUsedBytes, jsHeapLimitBytes, renderer } = samples.latest;
  const percent = (jsHeapUsedBytes / jsHeapLimitBytes) * 100;
  const high = isMemoryHigh(percent, renderer?.privateBytes);

  return (
    <Popover
      arrow={false}
      content={<MemoryPopover />}
      open={open}
      placement={'topRight'}
      positionerProps={{ sideOffset: 6 }}
      styles={{ content: { padding: 0 } }}
      trigger={'click'}
      zIndex={DOCK_Z_INDEX + 1}
      onOpenChange={setOpen}
    >
      <button
        type={'button'}
        {...stylex.props(
          barButtonStyles.button,
          styles.text,
          high ? styles.high : percent >= 70 ? styles.mid : undefined,
          open && styles.active,
        )}
        title={
          renderer
            ? 'R = Renderer private footprint (red at 1 GiB) · J = JS heap used — click for the full breakdown'
            : 'J = JS heap used — click for the full breakdown'
        }
      >
        {renderer && `R${formatCompactSize(renderer.privateBytes)} · `}J
        {formatCompactSize(jsHeapUsedBytes)}
      </button>
    </Popover>
  );
});

MemoryWidget.displayName = 'DevDockMemoryWidget';

export default MemoryWidget;
