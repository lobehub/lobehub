import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BadgeCheck, CircleAlert, Loader2, RotateCcw, Wrench } from 'lucide-react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import { decisionBarStyles as styles } from './decisionBarStyles';

export type DecisionBarState = 'accepted' | 'live' | 'rejected' | 'settled';

const RepairingMark = memo(() => {
  const size = 20;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ flex: 'none', height: size, position: 'relative', width: size }}>
      <svg height={size} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorWarningBg}
          strokeWidth={stroke}
        />
        <circle
          {...stylex.props(styles.repairingArc)}
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorWarning}
          strokeDasharray={`${circumference * 0.3} ${circumference}`}
          strokeLinecap={'round'}
          strokeWidth={stroke}
        />
      </svg>
      <Flexbox align={'center'} justify={'center'} style={{ inset: 0, position: 'absolute' }}>
        <Icon color={cssVar.colorWarning} icon={Wrench} size={12} />
      </Flexbox>
    </div>
  );
});

RepairingMark.displayName = 'AcceptanceRepairingMark';

const ProgressRing = memo<{ done: number; total: number }>(({ done, total }) => {
  const size = 20;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;

  if (done <= 0)
    return (
      <svg height={size} style={{ flex: 'none' }} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorTextQuaternary}
          strokeDasharray={'3 5'}
          strokeLinecap={'round'}
          strokeWidth={stroke}
        />
      </svg>
    );

  return (
    <div style={{ flex: 'none', height: size, position: 'relative', width: size }}>
      <svg height={size} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorFillSecondary}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorPrimary}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          strokeLinecap={'round'}
          strokeWidth={stroke}
          style={{ transition: 'stroke-dasharray 0.3s ease' }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <Flexbox
        align={'center'}
        justify={'center'}
        style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', inset: 0, position: 'absolute' }}
      >
        <span style={{ color: cssVar.colorTextSecondary, fontWeight: 600 }}>{done}</span>
      </Flexbox>
    </div>
  );
});

ProgressRing.displayName = 'AcceptanceProgressRing';

const STATE_MARK = {
  accepted: { color: cssVar.colorSuccess, icon: BadgeCheck },
  live: { color: cssVar.colorInfo, icon: Loader2 },
  rejected: { color: cssVar.colorError, icon: RotateCcw },
  settled: null,
} as const;

interface DecisionStatusMarkProps {
  allConfirmed: boolean;
  decidedCount: number;
  justCompleted: boolean;
  repairing?: boolean;
  settledNeedsFix: boolean;
  state: DecisionBarState;
  totalCount: number;
}

export const DecisionStatusMark = ({
  allConfirmed,
  decidedCount,
  justCompleted,
  repairing,
  settledNeedsFix,
  state,
  totalCount,
}: DecisionStatusMarkProps) => {
  if (state === 'live' && repairing) return <RepairingMark />;

  const stateMark = STATE_MARK[state];
  if (stateMark)
    return (
      <Icon
        color={stateMark.color}
        icon={stateMark.icon}
        size={22}
        spin={state === 'live'}
        style={{ flex: 'none' }}
      />
    );

  if (allConfirmed)
    return (
      <Icon
        color={cssVar.colorSuccess}
        icon={BadgeCheck}
        size={22}
        {...sx(justCompleted && styles.completePop, { flex: 'none' })}
      />
    );

  if (settledNeedsFix)
    return (
      <Icon
        color={cssVar.colorWarning}
        icon={CircleAlert}
        size={22}
        {...sx(justCompleted && styles.completePop, { flex: 'none' })}
      />
    );

  return <ProgressRing done={decidedCount} total={totalCount} />;
};
