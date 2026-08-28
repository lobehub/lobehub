'use client';

import type { VerifyRunStatus, VerifyVerdict } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui/es/Flex/index';
import Icon from '@lobehub/ui/es/Icon/index';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CircleCheck, CircleHelp, CircleX, LoaderCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { VerifyReportSummary } from '@/services/verify';

const styles = createStaticStyles(({ css }) => ({
  counts: css`
    em {
      font-style: normal;
      color: ${cssVar.colorError};
    }
  `,
  itemSub: css`
    overflow: hidden;

    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  main: css`
    cursor: pointer;

    overflow: hidden;
    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    padding-block: 10px;
    padding-inline: 10px;
    border: 0;
    border-radius: ${cssVar.borderRadiusLG};

    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  row: css`
    display: flex;
    align-items: stretch;
  `,
  spin: css`
    animation: workbench-verify-spin 0.9s linear infinite;

    @keyframes workbench-verify-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

type Glyph = 'ok' | 'bad' | 'unsure' | 'running';

const runningStatuses = new Set<VerifyRunStatus>(['planned', 'repairing', 'verifying']);

const glyphOf = (
  status: VerifyRunStatus | null,
  verdict: VerifyVerdict | null | undefined,
): Glyph => {
  if (status && runningStatuses.has(status)) return 'running';
  if (verdict === 'passed' || status === 'passed' || status === 'delivered') return 'ok';
  if (verdict === 'failed' || status === 'failed') return 'bad';
  return 'unsure';
};

const glyphMeta: Record<Glyph, { color: string; icon: typeof CircleCheck }> = {
  bad: { color: cssVar.colorError, icon: CircleX },
  ok: { color: cssVar.colorSuccess, icon: CircleCheck },
  running: { color: cssVar.colorInfo, icon: LoaderCircle },
  unsure: { color: cssVar.colorWarning, icon: CircleHelp },
};

const relativeTime = (value?: Date | string | null) => {
  if (!value) return '';
  const d = dayjs(value);
  return dayjs().diff(d, 'day') < 7 ? d.fromNow() : d.format('MMM D');
};

interface VerifyRowProps {
  item: VerifyReportSummary;
}

const VerifyRow = memo<VerifyRowProps>(({ item }) => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const status = item.run.status ?? null;
  const glyph = glyphOf(status, item.report?.verdict);
  const meta = glyphMeta[glyph];
  const planCount = Array.isArray(item.run.plan) ? item.run.plan.length : 0;
  const total = item.report?.totalChecks ?? planCount;
  const passed = item.report?.passedChecks ?? 0;
  const failed = item.report?.failedChecks ?? 0;
  const title = item.run.title || t('reports.untitled');
  const time =
    glyph === 'running'
      ? t('list.running')
      : relativeTime(item.report?.generatedAt ?? item.run.createdAt);

  return (
    <div className={styles.row}>
      <button
        className={styles.main}
        type={'button'}
        onClick={() => navigate(`/verify/${item.run.id}`)}
      >
        <Icon
          className={glyph === 'running' ? styles.spin : undefined}
          icon={meta.icon}
          size={17}
          style={{ color: meta.color }}
        />
        <span style={{ minWidth: 0 }}>
          <span className={styles.title}>{title}</span>
          <Flexbox horizontal className={styles.itemSub} gap={8}>
            {time ? <span>{time}</span> : null}
            {total > 0 && glyph !== 'running' ? (
              <span className={styles.counts}>
                {passed}/{total}
                {failed > 0 ? (
                  <>
                    {' · '}
                    <em>{t('list.failedCount', { count: failed })}</em>
                  </>
                ) : null}
              </span>
            ) : null}
          </Flexbox>
        </span>
      </button>
    </div>
  );
});

VerifyRow.displayName = 'VerifyRow';

export default VerifyRow;
