'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetRunItem } from '@/services/dashboard';

import { ErrorLine } from '../ErrorLine';
import { truncateLog } from '../utils/format';

const styles = stylex.create({
  log: {
    overflow: 'auto',
    maxHeight: '220px',
    margin: '0',
    padding: '8px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-all',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

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
          <pre {...stylex.props(styles.log)} data-run-log={stream}>
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
