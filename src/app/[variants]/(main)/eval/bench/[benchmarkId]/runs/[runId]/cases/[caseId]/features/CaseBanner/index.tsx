'use client';

import type { EvalRunTopicResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { ActionIcon, Flexbox, Tag } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStyles } from 'antd-style';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Footprints,
  Hash,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  backLink: css`
    cursor: pointer;
    color: ${token.colorTextTertiary};

    &:hover {
      color: ${token.colorText};
    }
  `,
  header: css`
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  metricCard: css`
    gap: 8px;

    padding-block: 6px;
    padding-inline: 8px 16px;
    border-radius: ${token.borderRadiusSM}px;

    font-size: 12px;

    background: ${token.colorFillQuaternary};
  `,
  metricIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${token.borderRadiusSM}px;

    color: ${token.colorTextTertiary};

    background: ${token.colorFillTertiary};
  `,
  metricLabel: css`
    font-size: 11px;
    line-height: 1;
    color: ${token.colorTextTertiary};
  `,
  metricValue: css`
    font-family: monospace;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    color: ${token.colorText};
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
}

const CaseHeader = memo<CaseHeaderProps>(
  ({ passed, caseNumber, runName, evalResult, onBack, onPrev, onNext }) => {
    const { t } = useTranslation('eval');
    const { styles } = useStyles();

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
      <Flexbox
        horizontal
        align="center"
        className={styles.header}
        gap={16}
        justify="space-between"
        padding={12}
      >
        <Flexbox gap={2}>
          <Flexbox horizontal align="center" className={styles.backLink} gap={4} onClick={onBack}>
            <ArrowLeft size={12} />
            <span style={{ fontSize: 12 }}>{runName}</span>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <ActionIcon disabled={!onPrev} icon={ChevronLeft} size="small" onClick={onPrev} />
            <Typography.Title level={5} style={{ fontSize: 20, margin: 0 }}>
              #{caseNumber}
            </Typography.Title>
            <ActionIcon disabled={!onNext} icon={ChevronRight} size="small" onClick={onNext} />
            {passed !== undefined && passed !== null && (
              <Tag color={passed ? 'success' : 'error'}>
                {passed ? t('table.filter.passed') : t('table.filter.failed')}
              </Tag>
            )}
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align="center" gap={8}>
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
      </Flexbox>
    );
  },
);

export default CaseHeader;
