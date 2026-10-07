'use client';

import type { EvalThreadResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { TriangleAlert } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useCaseErrorReason } from '../useCaseErrorReason';
import { getCaseVerdict } from '../verdict';
import { VERDICT_META } from '../VerdictTag';

const styles = createStaticStyles(({ css }) => ({
  caseLink: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    line-height: 1.5;
    color: ${cssVar.colorText};
    text-decoration: none;
    word-break: break-word;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  errorReason: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
    color: ${cssVar.colorWarningText};
    word-break: break-word;
  `,
  errorRow: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};
    background: ${cssVar.colorWarningBg};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
  `,
  sub: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  threadDot: css`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
}));

export const EmptyCell = () => <span className={styles.sub}>–</span>;

export const MonoCell = ({ sub, value }: { sub?: string; value: string }) => (
  <Flexbox gap={2}>
    <span className={styles.mono}>{value}</span>
    {sub && <span className={styles.sub}>{sub}</span>}
  </Flexbox>
);

/** The case input as a link to its transcript; an errored case states why, inline. */
export const InputCell = ({
  href,
  provider,
  record,
}: {
  href: string;
  provider?: string | null;
  record: any;
}) => {
  const isError = getCaseVerdict(record.status) === 'error';
  const reason = useCaseErrorReason(isError ? record.evalResult : undefined, provider);

  return (
    <Flexbox gap={6} style={{ minWidth: 0 }}>
      <WorkspaceLink className={styles.caseLink} to={href}>
        {record.testCase?.content?.input || record.testCaseId}
      </WorkspaceLink>
      {reason && (
        <Tooltip
          title={
            <span style={{ whiteSpace: 'pre-wrap' }}>
              {reason.message}
              {reason.code && `\n${reason.code}`}
            </span>
          }
        >
          <Flexbox horizontal align="flex-start" className={styles.errorRow} gap={6}>
            <Icon
              icon={TriangleAlert}
              size={12}
              style={{ color: cssVar.colorWarning, flex: 'none', marginTop: 3 }}
            />
            <span className={styles.errorReason}>{reason.message}</span>
          </Flexbox>
        </Tooltip>
      )}
    </Flexbox>
  );
};

export const DurationCell = ({ ms }: { ms: number }) => {
  const sec = ms / 1000;
  if (sec < 60) return <MonoCell value={`${sec.toFixed(1)}s`} />;
  return <MonoCell value={`${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`} />;
};

export const RunningTimer = ({ startTime }: { startTime: string }) => {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startTime).getTime());

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - new Date(startTime).getTime()), 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  return <DurationCell ms={elapsed} />;
};

export const CostCell = ({ cost, tokens }: { cost?: number | null; tokens?: number | null }) => {
  const { t } = useTranslation('eval');
  const hasCost = cost !== undefined && cost !== null;
  const hasTokens = tokens !== undefined && tokens !== null;
  if (!hasCost && !hasTokens) return <EmptyCell />;

  const tokenText = hasTokens ? `${formatShortenNumber(tokens)} ${t('run.metrics.tokens')}` : '';
  return hasCost ? (
    <MonoCell sub={tokenText || undefined} value={`$${formatCost(cost)}`} />
  ) : (
    <MonoCell value={tokenText} />
  );
};

const threadVerdict = (thread: EvalThreadResult) => {
  if (thread.error || thread.status === 'error') return 'error';
  if (thread.status === 'running') return 'running';
  if (thread.status === 'external') return 'external';
  if (thread.passed === true) return 'passed';
  if (thread.status === 'completed') return 'completed';
  if (thread.passed === false) return 'failed';
  return 'pending';
};

const DOT_COLOR = {
  completed: cssVar.colorPrimary,
  error: cssVar.colorWarning,
  external: cssVar.purple,
  failed: cssVar.colorError,
  passed: cssVar.colorSuccess,
  pending: cssVar.colorTextQuaternary,
  running: cssVar.colorPrimary,
} as const;

/** K dots, one per trajectory; the tooltip carries the verdict as text. */
export const ThreadDots = memo<{ threads: EvalThreadResult[] }>(({ threads }) => {
  const { t } = useTranslation('eval');
  return (
    <Flexbox horizontal align="center" gap={4} wrap="wrap">
      {threads.map((thread) => {
        const verdict = threadVerdict(thread);
        return (
          <Tooltip key={thread.threadId} title={t(VERDICT_META[verdict].labelKey as any)}>
            <span className={styles.threadDot} style={{ backgroundColor: DOT_COLOR[verdict] }} />
          </Tooltip>
        );
      })}
    </Flexbox>
  );
});
