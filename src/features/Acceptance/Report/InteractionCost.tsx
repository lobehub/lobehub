'use client';

import type { VerifyInteractionCost } from '@lobechat/types';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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

const styles = createStaticStyles(({ css }) => ({
  interactionCost: css`
    --klm-blue-1: color-mix(in srgb, ${cssVar.colorInfo} 70%, ${cssVar.colorBgContainer});
    --klm-blue-2: ${cssVar.colorInfo};
    --klm-blue-3: color-mix(in srgb, ${cssVar.colorInfo} 84%, ${cssVar.colorText});
    --klm-blue-4: color-mix(in srgb, ${cssVar.colorInfo} 68%, ${cssVar.colorText});
    --klm-blue-5: color-mix(in srgb, ${cssVar.colorInfo} 54%, ${cssVar.colorText});
    --klm-blue-6: color-mix(in srgb, ${cssVar.colorInfo} 42%, ${cssVar.colorText});

    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  `,
  interactionCostHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    justify-content: flex-end;
  `,
  interactionCostModel: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  interactionMetric: css`
    min-width: 0;
    padding-block: 9px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};
  `,
  interactionMetricLabel: css`
    display: block;
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  interactionMetricValue: css`
    font-size: 18px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
  interactionMetrics: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;

    @media (width <= 520px) {
      grid-template-columns: 1fr;
    }
  `,
  operatorChip: css`
    --operator-color: ${cssVar.colorTextSecondary};

    display: inline-flex;
    gap: 5px;
    align-items: baseline;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: color-mix(in srgb, var(--operator-color) 72%, ${cssVar.colorTextSecondary});

    &::before {
      content: '';

      flex: 0 0 auto;

      width: 6px;
      height: 6px;
      margin-block-start: 0.5em;
      border-radius: 50%;

      background: var(--operator-color);
    }

    b {
      font-weight: 650;
      color: var(--operator-color);
    }

    &[data-operator='K'] {
      --operator-color: var(--klm-blue-1);
    }

    &[data-operator='P'] {
      --operator-color: var(--klm-blue-2);
    }

    &[data-operator='M'] {
      --operator-color: var(--klm-blue-3);
    }

    &[data-operator='H'] {
      --operator-color: var(--klm-blue-4);
    }

    &[data-operator='T_chars'] {
      --operator-color: var(--klm-blue-5);
    }

    &[data-operator='R_ms'] {
      --operator-color: var(--klm-blue-6);
    }
  `,
  operatorList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
  `,
  /* Secondary to the phase name: it may be a long check title, so it is the part
     that gives way and truncates rather than squeezing the name out of the row. */
  phaseCheck: css`
    overflow: hidden;
    flex: 1 1 auto;

    min-width: 0;

    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  phaseList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  phaseName: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: baseline;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  /* The phase is what tells two rows apart, so it never shrinks — a long check
     title must not collapse it to nothing and leave the rows looking identical. */
  phaseSlug: css`
    overflow: hidden;
    flex: 0 0 auto;
    max-width: 60%;
    text-overflow: ellipsis;
  `,
  phaseRow: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(140px, 1.6fr) auto;
    gap: 10px;
    align-items: center;

    @media (width <= 640px) {
      grid-template-columns: 1fr;
      gap: 5px;
    }
  `,
  phaseSegment: css`
    --operator-color: ${cssVar.colorTextSecondary};

    flex: 0 0 auto;
    min-width: 2px;
    height: 100%;
    background: var(--operator-color);

    &[data-operator='K'] {
      --operator-color: var(--klm-blue-1);
    }

    &[data-operator='P'] {
      --operator-color: var(--klm-blue-2);
    }

    &[data-operator='M'] {
      --operator-color: var(--klm-blue-3);
    }

    &[data-operator='H'] {
      --operator-color: var(--klm-blue-4);
    }

    &[data-operator='T_chars'] {
      --operator-color: var(--klm-blue-5);
    }

    &[data-operator='R_ms'] {
      --operator-color: var(--klm-blue-6);
    }
  `,
  phaseTrack: css`
    overflow: hidden;
    display: flex;

    height: 8px;
    border-radius: 999px;

    background: transparent;
    box-shadow: inset 0 0 0 1px ${cssVar.colorBorderSecondary};
  `,
  phaseValue: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

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
      <section className={styles.interactionCost}>
        <div className={styles.interactionCostHeader}>
          {roundLabel && <span className={styles.interactionCostModel}>{roundLabel}</span>}
          <span className={styles.interactionCostModel}>{cost.model}</span>
        </div>

        <div className={styles.interactionMetrics}>
          {metrics.map((metric) => (
            <div className={styles.interactionMetric} key={metric.label}>
              <span className={styles.interactionMetricLabel}>{metric.label}</span>
              <span className={styles.interactionMetricValue}>{metric.value}</span>
            </div>
          ))}
        </div>

        <div className={styles.operatorList}>
          {OPERATOR_KEYS.map((key) => {
            const value = cost.operators[key];
            if (value === undefined) return null;

            return (
              <span className={styles.operatorChip} data-operator={key} key={key}>
                <span>{t(`report.interaction.operator.${key}`)}</span>
                <b>{operatorValue(key, value)}</b>
              </span>
            );
          })}
        </div>

        {phases.length > 0 && (
          <div className={styles.phaseList}>
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
                <div className={styles.phaseRow} key={phase.id}>
                  <span
                    className={styles.phaseName}
                    title={checkLabel ? `${name} · ${checkLabel}` : name}
                  >
                    <span className={styles.phaseSlug}>{name}</span>
                    {checkLabel && <span className={styles.phaseCheck}>{checkLabel}</span>}
                  </span>
                  <span className={styles.phaseTrack}>
                    {segments.length > 0 ? (
                      segments.map((segment) => (
                        <span
                          className={styles.phaseSegment}
                          data-operator={segment.key}
                          key={segment.key}
                          style={{
                            width: `${
                              maxPhaseSeconds > 0 ? (segment.seconds / maxPhaseSeconds) * 100 : 0
                            }%`,
                          }}
                          title={`${t(`report.interaction.operator.${segment.key}`)} ${formatSeconds(
                            segment.seconds,
                          )}`}
                        />
                      ))
                    ) : (
                      <>
                        <span
                          className={styles.phaseSegment}
                          style={{ width: `${activeWidth}%` }}
                        />
                        <span
                          className={styles.phaseSegment}
                          data-operator={'R_ms'}
                          style={{ width: `${waitWidth}%` }}
                        />
                      </>
                    )}
                  </span>
                  <span className={styles.phaseValue}>{formatSeconds(seconds)}</span>
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
