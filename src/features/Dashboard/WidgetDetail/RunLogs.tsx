'use client';

import { createStaticStyles, cssVar,Flexbox, Text   } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetRunItem } from '@/services/dashboard';

import { ErrorLine } from '../ErrorLine';
import { truncateLog } from '../utils/format';

const styles = createStaticStyles(({ css }) => ({
  log: css`
    overflow: auto;

    max-height: 220px;
    margin: 0;
    padding: 8px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    word-break: break-all;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

const LogBlock = memo<{ label: string; stream: 'stdout' | 'stderr'; text?: string | null }>(
  ({ label, stream, text }) => {
    const { t } = useTranslation('dashboard');
    const preview = truncateLog(text);

    return (
      <Flexbox gap={4}>
        <Text fontSize={12} weight={500}>
          {label}
        </Text>
        {preview.text ? (
          <pre className={styles.log} data-run-log={stream}>
            {preview.text}
            {preview.truncated && `\n… ${t('run.logTruncated')}`}
          </pre>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            {t('run.logEmpty')}
          </Text>
        )}
      </Flexbox>
    );
  },
);

LogBlock.displayName = 'DashboardRunLogBlock';

/** Error, stdout and stderr of one run, each capped for display. */
const RunLogs = memo<{ run: DashboardWidgetRunItem }>(({ run }) => {
  const { t } = useTranslation('dashboard');

  return (
    <Flexbox gap={12}>
      {run.error && (
        <ErrorLine detail={`[${run.error.code}] ${run.error.message}`} summary={t('run.error')} />
      )}
      <LogBlock label={'stdout'} stream={'stdout'} text={run.stdout} />
      <LogBlock label={'stderr'} stream={'stderr'} text={run.stderr} />
    </Flexbox>
  );
});

RunLogs.displayName = 'DashboardRunLogs';

export default RunLogs;
