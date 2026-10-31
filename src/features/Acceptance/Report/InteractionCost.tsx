'use client';

import type { VerifyInteractionCost } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import {
  formatSeconds,
  OPERATOR_KEYS,
  operatorValue,
  phaseOperatorSegments,
  phaseSeconds,
} from './interactionCostModel';

export { formatSeconds, readInteractionCost } from './interactionCostModel';

/**
 * The round's user-equivalent interaction cost, and the reader that lifts it off
 * a run's metadata bag.
 *
 * Extracted from ReportViewer so the acceptance aggregate can render it too:
 * the report only opens from owner-scoped round history, so a panel living
 * solely there is invisible to exactly the audience the number is for — the
 * reviewer deciding whether a flow is worth accepting.
 */

const styles = stylex.create({
  interactionCost: {
    '--klm-blue-1': `color-mix(in srgb, ${cssVar.colorInfo} 70%, ${cssVar.colorBgContainer})`,
    '--klm-blue-2': cssVar.colorInfo,
    '--klm-blue-3': `color-mix(in srgb, ${cssVar.colorInfo} 84%, ${cssVar.colorText})`,
    '--klm-blue-4': `color-mix(in srgb, ${cssVar.colorInfo} 68%, ${cssVar.colorText})`,
    '--klm-blue-5': `color-mix(in srgb, ${cssVar.colorInfo} 54%, ${cssVar.colorText})`,
    '--klm-blue-6': `color-mix(in srgb, ${cssVar.colorInfo} 42%, ${cssVar.colorText})`,
    'display': 'flex',
    'flexDirection': 'column',
    'gap': '12px',
    'width': '100%',
  },
  interactionCostHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: '12px',
    rowGap: '8px',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  interactionCostModel: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  interactionMetric: {
    minWidth: '0',
    paddingBlock: '9px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusSM,
  },
  interactionMetricLabel: {
    display: 'block',
    marginBlockEnd: '4px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  interactionMetricValue: {
    fontSize: '18px',
    fontWeight: 650,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.2,
    color: cssVar.colorText,
  },
  interactionMetrics: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(3, minmax(0, 1fr))',
      '@media (width <= 520px)': '1fr',
    },
    gap: '8px',
  },
  operatorChip: {
    '--operator-color': cssVar.colorTextSecondary,
    'display': 'inline-flex',
    'gap': '5px',
    'alignItems': 'baseline',
    'fontFamily': cssVar.fontFamilyCode,
    'fontSize': '12px',
    'color': `color-mix(in srgb, var(--operator-color) 72%, ${cssVar.colorTextSecondary})`,
    '::before': {
      content: '""',
      flexGrow: '0',
      flexShrink: '0',
      flexBasis: 'auto',
      width: '6px',
      height: '6px',
      marginBlockStart: '0.5em',
      borderRadius: '50%',
      backgroundColor: 'var(--operator-color)',
      backgroundImage: 'none',
    },
  },
  operatorValue: { fontWeight: 650, color: 'var(--operator-color)' },
  operatorK: { '--operator-color': 'var(--klm-blue-1)' },
  operatorP: { '--operator-color': 'var(--klm-blue-2)' },
  operatorM: { '--operator-color': 'var(--klm-blue-3)' },
  operatorH: { '--operator-color': 'var(--klm-blue-4)' },
  operatorTChars: { '--operator-color': 'var(--klm-blue-5)' },
  operatorRMs: { '--operator-color': 'var(--klm-blue-6)' },
  operatorList: { display: 'flex', flexWrap: 'wrap', columnGap: '14px', rowGap: '8px' },
  /* Secondary to the phase name: it may be a long check title, so it is the part
     that gives way and truncates rather than squeezing the name out of the row. */
  phaseCheck: {
    overflow: 'hidden',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: '0',
    fontSize: '11px',
    color: cssVar.colorTextQuaternary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  phaseList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  phaseName: {
    overflow: 'hidden',
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
    minWidth: '0',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  /* The phase is what tells two rows apart, so it never shrinks — a long check
     title must not collapse it to nothing and leave the rows looking identical. */
  phaseSlug: {
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    maxWidth: '60%',
    textOverflow: 'ellipsis',
  },
  phaseRow: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(120px, 1fr) minmax(140px, 1.6fr) auto',
      '@media (width <= 640px)': '1fr',
    },
    gap: { 'default': '10px', '@media (width <= 640px)': '5px' },
    alignItems: 'center',
  },
  phaseSegment: {
    '--operator-color': cssVar.colorTextSecondary,
    'flexGrow': '0',
    'flexShrink': '0',
    'flexBasis': 'auto',
    'minWidth': '2px',
    'height': '100%',
    'backgroundColor': 'var(--operator-color)',
    'backgroundImage': 'none',
  },
  phaseTrack: {
    overflow: 'hidden',
    display: 'flex',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: `inset 0 0 0 1px ${cssVar.colorBorderSecondary}`,
  },
  phaseValue: {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
});

const operatorStyles = {
  H: styles.operatorH,
  K: styles.operatorK,
  M: styles.operatorM,
  P: styles.operatorP,
  R_ms: styles.operatorRMs,
  T_chars: styles.operatorTChars,
} as const;

const operatorStyle = (key?: string) =>
  key && key in operatorStyles ? operatorStyles[key as keyof typeof operatorStyles] : undefined;

export interface InteractionCostPanelProps {
  /**
   * `checkItemId` → the check's display label. A phase the driver attributed to
   * a check then names it, so a reviewer reads the cost against the thing being
   * judged rather than against an internal phase slug.
   */
  checkLabels?: Record<string, string>;
  cost: VerifyInteractionCost;
  /** Which round this measurement came from, when the host shows several. */
  roundLabel?: string;
}

const InteractionCostPanel = memo<InteractionCostPanelProps>(
  ({ checkLabels, cost, roundLabel }) => {
    const { t } = useTranslation('verify');
    const phases = cost.phases ?? [];
    const maxPhaseSeconds = Math.max(...phases.map(phaseSeconds), 0);
    const metrics = [
      {
        label: t('report.interaction.total'),
        value: formatSeconds(cost.totalSeconds),
      },
      {
        label: t('report.interaction.active'),
        value: formatSeconds(cost.activeSeconds),
      },
      {
        label: t('report.interaction.wait'),
        value: formatSeconds(cost.waitSeconds),
      },
    ];

    return (
      <section {...stylex.props(styles.interactionCost)}>
        <div {...stylex.props(styles.interactionCostHeader)}>
          {roundLabel && <span {...stylex.props(styles.interactionCostModel)}>{roundLabel}</span>}
          <span {...stylex.props(styles.interactionCostModel)}>{cost.model}</span>
        </div>

        <div {...stylex.props(styles.interactionMetrics)}>
          {metrics.map((metric) => (
            <div {...stylex.props(styles.interactionMetric)} key={metric.label}>
              <span {...stylex.props(styles.interactionMetricLabel)}>{metric.label}</span>
              <span {...stylex.props(styles.interactionMetricValue)}>{metric.value}</span>
            </div>
          ))}
        </div>

        <div {...stylex.props(styles.operatorList)}>
          {OPERATOR_KEYS.map((key) => {
            const value = cost.operators[key];
            if (value === undefined) return null;

            return (
              <span
                {...stylex.props(styles.operatorChip, operatorStyle(key))}
                data-operator={key}
                key={key}
              >
                <span>{t(`report.interaction.operator.${key}`)}</span>
                <b {...stylex.props(styles.operatorValue)}>{operatorValue(key, value)}</b>
              </span>
            );
          })}
        </div>

        {phases.length > 0 && (
          <div {...stylex.props(styles.phaseList)}>
            {phases.map((phase) => {
              const seconds = phaseSeconds(phase);
              const activeSeconds = phase.activeSeconds ?? 0;
              const waitSeconds = phase.waitSeconds ?? 0;
              const activeWidth = maxPhaseSeconds > 0 ? (activeSeconds / maxPhaseSeconds) * 100 : 0;
              const waitWidth = maxPhaseSeconds > 0 ? (waitSeconds / maxPhaseSeconds) * 100 : 0;
              const segments = phaseOperatorSegments(phase, cost.timingSeconds);
              const name = phase.label ?? phase.id;
              const checkLabel = phase.checkItemId
                ? (checkLabels?.[phase.checkItemId] ?? phase.checkItemId)
                : undefined;

              return (
                <div {...stylex.props(styles.phaseRow)} key={phase.id}>
                  <span
                    {...stylex.props(styles.phaseName)}
                    title={checkLabel ? `${name} · ${checkLabel}` : name}
                  >
                    <span {...stylex.props(styles.phaseSlug)}>{name}</span>
                    {checkLabel && <span {...stylex.props(styles.phaseCheck)}>{checkLabel}</span>}
                  </span>
                  <span {...stylex.props(styles.phaseTrack)}>
                    {segments.length > 0 ? (
                      segments.map((segment) => (
                        <span
                          {...sx([styles.phaseSegment, operatorStyle(segment.key)], undefined, {
                            width: `${
                              maxPhaseSeconds > 0 ? (segment.seconds / maxPhaseSeconds) * 100 : 0
                            }%`,
                          })}
                          data-operator={segment.key}
                          key={segment.key}
                          title={`${t(`report.interaction.operator.${segment.key}`)} ${formatSeconds(
                            segment.seconds,
                          )}`}
                        />
                      ))
                    ) : (
                      <>
                        <span
                          {...sx([styles.phaseSegment], undefined, { width: `${activeWidth}%` })}
                        />
                        <span
                          {...sx([styles.phaseSegment, styles.operatorRMs], undefined, {
                            width: `${waitWidth}%`,
                          })}
                          data-operator={'R_ms'}
                        />
                      </>
                    )}
                  </span>
                  <span {...stylex.props(styles.phaseValue)}>{formatSeconds(seconds)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  },
);

InteractionCostPanel.displayName = 'InteractionCostPanel';

export default InteractionCostPanel;
