import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { DecisionSegment } from '../Checks/checkDecision';

const styles = stylex.create({
  strip: {
    display: 'flex',
    gap: '2px',
    height: '4px',
  },
  segment: {
    flex: '1',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
  },
  accepted: { backgroundColor: cssVar.colorSuccess },
  needsFix: { backgroundColor: cssVar.colorError },
  ignored: { backgroundColor: cssVar.colorTextQuaternary },
  pending: {},
});

interface DecisionStripProps {
  label: string;
  /** Applied after `segmentXstyle` to undecided segments only. */
  pendingXstyle?: StyleXStyles;
  segments: DecisionSegment[];
  segmentXstyle?: StyleXStyles;
  xstyle?: StyleXStyles;
}

const DecisionStrip = memo<DecisionStripProps>(
  ({ label, pendingXstyle, segmentXstyle, segments, xstyle }) => (
    <div aria-label={label} role={'img'} {...stylex.props(styles.strip, xstyle)}>
      {segments.map((segment, index) => (
        <i
          data-decision={segment}
          key={index}
          {...stylex.props(
            styles.segment,
            styles[segment],
            segmentXstyle,
            segment === 'pending' && pendingXstyle,
          )}
        />
      ))}
    </div>
  ),
);

DecisionStrip.displayName = 'AcceptanceDecisionStrip';

export default DecisionStrip;
