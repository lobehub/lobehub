'use client';

import type { EvalRunTopicResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Alert } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCaseErrorReason } from '@/features/Eval/Run/useCaseErrorReason';
import { getCaseVerdict } from '@/features/Eval/Run/verdict';
import VerdictTag from '@/features/Eval/Run/VerdictTag';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    flex: none;
    padding-block: 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  crumb: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  errorText: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    word-break: break-word;
  `,
  input: css`
    overflow: hidden;

    max-width: 720px;
    margin: 0;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  metric: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  metricValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  title: css`
    margin: 0;
    font-size: ${cssVar.fontSizeHeading4};
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
  `,
}));

interface CaseBannerProps {
  caseNumber: number;
  evalResult?: EvalRunTopicResult | null;
  input?: string;
  onNext?: () => void;
  onPrev?: () => void;
  provider?: string | null;
  runHref: string;
  runName: string;
  status?: string | null;
}

/** Where this case sits (run › case), how it ended, what it cost — and why, when it errored. */
const CaseBanner = ({
  caseNumber,
  evalResult,
  input,
  onNext,
  onPrev,
  provider,
  runHref,
  runName,
  status,
}: CaseBannerProps) => {
  const { t } = useTranslation('eval');
  const verdict = getCaseVerdict(status);
  const errorReason = useCaseErrorReason(evalResult, provider);

  const metrics = [
    {
      label: t('caseDetail.duration'),
      value: evalResult?.duration != null ? `${(evalResult.duration / 1000).toFixed(1)}s` : null,
    },
    {
      label: t('caseDetail.steps'),
      value: evalResult?.steps != null ? String(evalResult.steps) : null,
    },
    {
      label: t('caseDetail.tokens'),
      value: evalResult?.tokens != null ? formatShortenNumber(evalResult.tokens) : null,
    },
    {
      label: t('caseDetail.cost'),
      value: evalResult?.cost != null ? `$${formatCost(evalResult.cost)}` : null,
    },
  ].filter((m) => m.value !== null);

  return (
    <Flexbox className={styles.banner} gap={12}>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          <WorkspaceLink className={styles.crumb} to={runHref}>
            <Icon icon={ChevronLeft} size={14} />
            {runName}
          </WorkspaceLink>
          <Flexbox horizontal align="center" gap={12}>
            <h1 className={styles.title}>{t('run.case.title', { number: caseNumber })}</h1>
            <VerdictTag verdict={verdict} />
          </Flexbox>
          {input && (
            <p className={styles.input} title={input}>
              {input}
            </p>
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={4} style={{ flex: 'none' }}>
          <ActionIcon
            disabled={!onPrev}
            icon={ChevronLeft}
            title={t('run.case.prev')}
            onClick={onPrev}
          />
          <ActionIcon
            disabled={!onNext}
            icon={ChevronRight}
            title={t('run.case.next')}
            onClick={onNext}
          />
        </Flexbox>
      </Flexbox>

      {metrics.length > 0 && (
        <Flexbox horizontal align="center" gap={20} wrap="wrap">
          {metrics.map((m) => (
            <span className={styles.metric} key={m.label}>
              {m.label} <span className={styles.metricValue}>{m.value}</span>
            </span>
          ))}
        </Flexbox>
      )}

      {errorReason && (
        <Alert
          showIcon
          title={t('run.case.errorTitle')}
          type={verdict === 'error' ? 'warning' : 'error'}
          variant="outlined"
          description={
            <Flexbox gap={4}>
              <span>{errorReason.message}</span>
              {errorReason.code && <span className={styles.errorText}>{errorReason.code}</span>}
            </Flexbox>
          }
        />
      )}
    </Flexbox>
  );
};

export default CaseBanner;
