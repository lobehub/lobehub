'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Brain, ChartBar, Clock, MessageSquare } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  center: {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    margin: 'auto',
    borderRadius: '999px',
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorWarningBg,
    backgroundImage: 'none',
  },
  container: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '320px',
  },
  hint: { marginBlockStart: '24px', fontSize: cssVar.fontSize, color: cssVar.colorTextQuaternary },
  icon: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: cssVar.borderRadius,
  },
  icon1: {
    insetBlockStart: '15px',
    insetInlineStart: '100px',
    color: cssVar.geekblue,
    backgroundColor: cssVar.geekblue1,
    backgroundImage: 'none',
  },
  icon2: {
    insetBlockStart: '143px',
    insetInlineStart: '174px',
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
  icon3: {
    insetBlockStart: '143px',
    insetInlineStart: '26px',
    color: cssVar.purple,
    backgroundColor: cssVar.purple1,
    backgroundImage: 'none',
  },
  orbit: {
    position: 'absolute',
    inset: '0',
    margin: 'auto',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
  },
  orbit1: { width: '200px', height: '200px' },
  orbit2: { width: '140px', height: '140px' },
  orbit3: { width: '80px', height: '80px' },
  orbitGroup: { position: 'relative', width: '200px', height: '200px' },
});

const PendingState = memo(({ hint }: { hint?: string }) => {
  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.orbitGroup)}>
        <div {...stylex.props(styles.orbit, styles.orbit1)} />
        <div {...stylex.props(styles.orbit, styles.orbit2)} />
        <div {...stylex.props(styles.orbit, styles.orbit3)} />
        <div {...stylex.props(styles.icon, styles.icon1)}>
          <Icon icon={Brain} size={16} />
        </div>
        <div {...stylex.props(styles.icon, styles.icon2)}>
          <Icon icon={MessageSquare} size={16} />
        </div>
        <div {...stylex.props(styles.icon, styles.icon3)}>
          <Icon icon={ChartBar} size={16} />
        </div>
        <div {...stylex.props(styles.center)}>
          <Icon icon={Clock} size={18} />
        </div>
      </div>
      <div {...stylex.props(styles.hint)}>{hint}</div>
    </div>
  );
});

export default PendingState;
