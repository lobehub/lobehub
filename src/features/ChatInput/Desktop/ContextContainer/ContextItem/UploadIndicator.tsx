import { Progress } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

/** Arc length shown while the upload has no measurable progress. */
const INDETERMINATE_PERCENT = 25;

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
  },
  spinning: {
    animationName: spin,
    animationDuration: '0.9s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

interface UploadIndicatorProps {
  label: string;
  /** Upload percentage; `undefined` while it cannot be measured (pending, processing). */
  progress?: number;
  size: number;
}

/**
 * One ring for the whole upload lifecycle: it fills while byte progress is known and spins as
 * an arc otherwise. Switching between a progress ring and a separate spinner icon made the
 * indicator change size and shape mid-upload.
 */
const UploadIndicator = ({ label, progress, size }: UploadIndicatorProps) => {
  const indeterminate = progress === undefined;

  return (
    <span {...sx(styles.root, indeterminate && styles.spinning, { height: size, width: size })}>
      <Progress
        aria-label={label}
        // The spinning arc is decorative: announce the step, not a fake 25%.
        {...(indeterminate && { 'aria-valuenow': undefined, 'aria-valuetext': label })}
        percent={indeterminate ? INDETERMINATE_PERCENT : progress}
        showInfo={false}
        size={size}
        status={'normal'}
        type={'circle'}
      />
    </span>
  );
};

export default UploadIndicator;
