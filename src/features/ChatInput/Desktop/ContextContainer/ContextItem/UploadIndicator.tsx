import { Progress } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

/** Arc length of the spinning ring. */
const ARC_PERCENT = 25;

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  root: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    animationName: spin,
    animationDuration: '0.9s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

interface UploadIndicatorProps {
  label: string;
  size: number;
}

/**
 * One spinning ring for the whole upload. Users do not need the internal steps (hashing,
 * transfer, server processing); switching between a progress ring and a separate spinner icon
 * per step made the indicator change size and shape mid-upload.
 */
const UploadIndicator = ({ label, size }: UploadIndicatorProps) => (
  <span {...sx(styles.root, { height: size, width: size })}>
    <Progress
      aria-label={label}
      // The arc is decorative: announce the upload, not a fake 25%.
      aria-valuenow={undefined}
      aria-valuetext={label}
      percent={ARC_PERCENT}
      showInfo={false}
      size={size}
      status={'normal'}
      type={'circle'}
    />
  </span>
);

export default UploadIndicator;
