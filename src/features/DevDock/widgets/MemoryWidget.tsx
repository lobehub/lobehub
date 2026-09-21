'use client';

import { Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, useState } from 'react';

import { DOCK_Z_INDEX } from '../const';
import { barButtonStyles } from './BarButton';
import { formatCompactSize } from './memoryFormat';
import MemoryPopover from './MemoryPopover';
import { isMemorySamplingSupported, useMemorySamples } from './memorySamples';
import { isMemoryHigh } from './metricUtils';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  high: css`
    color: ${cssVar.colorError};
  `,
  mid: css`
    color: ${cssVar.colorWarning};
  `,
  text: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextTertiary};
  `,
}));

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
        className={cx(
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
