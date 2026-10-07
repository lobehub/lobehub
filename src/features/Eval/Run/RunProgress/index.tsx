'use client';

import type { AgentEvalRunDetail } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, confirmModal, Progress, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Clock, Hourglass, Loader2, type LucideIcon, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

import { countVerdicts } from '../verdict';

const styles = createStaticStyles(({ css }) => ({
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  dot: css`
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
  hint: css`
    margin: 0;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillTertiary};
  `,
  legend: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  panel: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  title: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
  `,
  total: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const STATE: Record<string, { color: string; hintKey: string; icon: LucideIcon; spin?: boolean }> =
  {
    external: { color: cssVar.purple, hintKey: 'run.external.hint', icon: Hourglass },
    idle: { color: cssVar.colorTextSecondary, hintKey: 'run.idle.hint', icon: Play },
    pending: { color: cssVar.colorWarning, hintKey: 'run.pending.hint', icon: Clock },
    running: { color: cssVar.colorPrimary, hintKey: 'run.running.hint', icon: Loader2, spin: true },
  };

interface RunProgressProps {
  results: { status?: string | null }[];
  run: AgentEvalRunDetail;
}

/** A run that has not finished: what it is doing, how far along, and what has landed so far. */
const RunProgress = ({ run, results }: RunProgressProps) => {
  const { t } = useTranslation('eval');
  const startRun = useEvalStore((s) => s.startRun);
  const [starting, setStarting] = useState(false);
  const state = STATE[run.status] ?? STATE.idle;

  const total = run.metrics?.totalCases || results.length;
  const done = run.metrics?.completedCases ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const counts = countVerdicts(results);

  const handleStart = () =>
    confirmModal({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          setStarting(true);
          await startRun(run.id, false);
        } catch (error: any) {
          toast.error(error?.message || t('run.error.start'));
        } finally {
          setStarting(false);
        }
      },
      title: t('run.actions.start'),
    });

  const legend = [
    { color: cssVar.colorSuccess, count: counts.passed, label: t('table.filter.passed') },
    { color: cssVar.colorError, count: counts.failed, label: t('table.filter.failed') },
    { color: cssVar.colorWarning, count: counts.error, label: t('table.filter.error') },
    { color: cssVar.colorPrimary, count: counts.running, label: t('run.status.running') },
  ];

  return (
    <Flexbox className={styles.panel} gap={16}>
      <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
        <Flexbox horizontal align="center" gap={12}>
          <div className={styles.icon} style={{ color: state.color }}>
            <Icon icon={state.icon} size={18} spin={state.spin} />
          </div>
          <Flexbox gap={2}>
            <span className={styles.title}>{t(`run.status.${run.status}` as any)}</span>
            <p className={styles.hint}>{t(state.hintKey as any)}</p>
          </Flexbox>
        </Flexbox>
        {run.status === 'idle' && (
          <Button icon={<Play size={14} />} loading={starting} type="primary" onClick={handleStart}>
            {t('run.actions.start')}
          </Button>
        )}
      </Flexbox>

      {run.status !== 'idle' && total > 0 && (
        <Flexbox gap={8}>
          <Flexbox horizontal align="center" justify="space-between">
            <span className={styles.total}>{t('run.progress.cases', { done, total })}</span>
            <span className={styles.total}>{percent}%</span>
          </Flexbox>
          <Progress
            percent={percent}
            showInfo={false}
            status={run.status === 'running' ? 'active' : undefined}
            style={{ margin: 0 }}
          />
          <Flexbox horizontal gap={16} wrap="wrap">
            {legend.map((item) => (
              <Flexbox horizontal align="center" className={styles.legend} gap={6} key={item.label}>
                <span className={styles.dot} style={{ background: item.color }} />
                {item.label}
                <span className={styles.count}>{item.count}</span>
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default RunProgress;
