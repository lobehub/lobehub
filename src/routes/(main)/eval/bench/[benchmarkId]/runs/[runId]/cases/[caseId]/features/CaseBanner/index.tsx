'use client';

import type { EvalRunTopicResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Footprints,
  Hash,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  backLink: css`
    align-self: flex-start;

    cursor: pointer;
    border-radius: ${cssVar.borderRadiusSM};
    color: ${cssVar.colorTextTertiary};

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  // Tonal outcome hero band — leads with the case result.
  hero: css`
    padding: 16px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    padding-block: 16px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  metricCard: css`
    gap: 8px;

    padding-block: 8px;
    padding-inline: 8px 16px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: ${cssVar.fontSizeSM};

    background: ${cssVar.colorBgContainer};
  `,
  metricIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  metricLabel: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  metricValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  // Large mono score in the hero.
  scoreValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading2};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  // The result word, color-coded — always paired with an icon.
  statusLabel: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    line-height: 1;
  `,
  statusTile: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 44px;
    height: 44px;
    border-radius: ${cssVar.borderRadius};
  `,
}));

interface CaseHeaderProps {
  caseNumber: number;
  evalResult?: EvalRunTopicResult | null;
  onBack: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  passed?: boolean | null;
  runName: string;
  score?: number | null;
}

const CaseHeader = memo<CaseHeaderProps>(
  ({ passed, caseNumber, runName, evalResult, onBack, onPrev, onNext, score }) => {
    const { t } = useTranslation('eval');

    // Resolve the outcome: error (run threw) > failed > passed > unknown.
    // Color is always paired with an icon + label, never used alone.
    const hasError = !!evalResult?.error;
    const outcome = hasError
      ? {
          bg: cssVar.colorErrorBg,
          color: cssVar.colorError,
          icon: TriangleAlert,
          label: t('table.filter.error'),
        }
      : passed === true
        ? {
            bg: cssVar.colorSuccessBg,
            color: cssVar.colorSuccess,
            icon: CheckCircle2,
            label: t('table.filter.passed'),
          }
        : passed === false
          ? {
              bg: cssVar.colorErrorBg,
              color: cssVar.colorError,
              icon: XCircle,
              label: t('table.filter.failed'),
            }
          : null;

    const hasScore = score !== undefined && score !== null;

    const metrics = [
      {
        icon: Clock,
        label: t('caseDetail.duration'),
        value: evalResult?.duration != null ? `${(evalResult.duration / 1000).toFixed(1)}s` : null,
      },
      {
        icon: Footprints,
        label: t('caseDetail.steps'),
        value: evalResult?.steps != null ? String(evalResult.steps) : null,
      },
      {
        icon: DollarSign,
        label: t('caseDetail.cost'),
        value: evalResult?.cost != null ? `$${formatCost(evalResult.cost)}` : null,
      },
      {
        icon: Hash,
        label: t('caseDetail.tokens'),
        value: evalResult?.tokens != null ? formatShortenNumber(evalResult.tokens) : null,
      },
    ].filter((m) => m.value !== null);

    return (
      <Flexbox className={styles.header} gap={16}>
        {/* Identity row: breadcrumb back + case number + prev/next nav */}
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Flexbox gap={4}>
            <Flexbox
              horizontal
              align="center"
              className={styles.backLink}
              gap={4}
              role="button"
              tabIndex={0}
              onClick={onBack}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onBack();
                }
              }}
            >
              <ArrowLeft size={12} />
              <Text fontSize={12}>{runName}</Text>
            </Flexbox>
            <Text as="h4" style={{ fontSize: 20, margin: 0 }} weight={600}>
              #{caseNumber}
            </Text>
          </Flexbox>

          <Flexbox horizontal align="center" gap={8}>
            <ActionIcon disabled={!onPrev} icon={ChevronLeft} size="small" onClick={onPrev} />
            <ActionIcon disabled={!onNext} icon={ChevronRight} size="small" onClick={onNext} />
          </Flexbox>
        </Flexbox>

        {/* Outcome hero — the result is the centerpiece */}
        {(outcome || hasScore) && (
          <Flexbox horizontal align="center" className={styles.hero} gap={16}>
            {outcome && (
              <Flexbox horizontal align="center" flex={1} gap={12}>
                <div className={styles.statusTile} style={{ background: outcome.bg }}>
                  <Icon icon={outcome.icon} size={24} style={{ color: outcome.color }} />
                </div>
                <span className={styles.statusLabel} style={{ color: outcome.color }}>
                  {outcome.label}
                </span>
              </Flexbox>
            )}

            {hasScore && (
              <Flexbox align="flex-end" gap={2}>
                <span className={styles.scoreValue}>{score.toFixed(2)}</span>
                <span className={styles.metricLabel}>{t('caseDetail.score')}</span>
              </Flexbox>
            )}
          </Flexbox>
        )}

        {/* Runtime metric pills */}
        {metrics.length > 0 && (
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            {metrics.map((m) => (
              <Flexbox horizontal align="center" className={styles.metricCard} key={m.label}>
                <div className={styles.metricIcon}>
                  <m.icon size={14} />
                </div>
                <Flexbox gap={0}>
                  <span className={styles.metricLabel}>{m.label}</span>
                  <span className={styles.metricValue}>{m.value}</span>
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default CaseHeader;
