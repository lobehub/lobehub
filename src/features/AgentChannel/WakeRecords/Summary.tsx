'use client';

import { Flexbox, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { formatShortenNumber } from '@/utils/format';

import { useWakeSummary } from './useWakeRecords';

const styles = stylex.create({
  cell: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: 8,
    flex: '1',
    minWidth: 104,
    paddingBlock: 10,
    paddingInline: 12,
  },
});

const METRICS = ['wake', 'skip', 'defer', 'followupWakes', 'marked'] as const;
type Metric = (typeof METRICS)[number];

const LABEL_KEY: Record<Metric, string> = {
  defer: 'channel.records.summary.defer',
  followupWakes: 'channel.records.summary.followup',
  marked: 'channel.records.summary.marked',
  skip: 'channel.records.summary.skip',
  wake: 'channel.records.summary.wake',
};

/** Last-30-days counts: what the bot did with the messages it judged, and how many you marked. */
export const Summary = ({ botId }: { botId: string }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const { data, error, isLoading, mutate } = useWakeSummary(botId);

  return (
    <Flexbox horizontal gap={8} wrap={'wrap'}>
      {METRICS.map((metric) => (
        <Flexbox gap={2} key={metric} {...stylex.props(styles.cell)}>
          {metric === 'followupWakes' ? (
            <Tooltip title={t('channel.records.summary.followupHint')}>
              <Text fontSize={12} type={'secondary'}>
                {t(LABEL_KEY[metric])}
              </Text>
            </Tooltip>
          ) : (
            <Text fontSize={12} type={'secondary'}>
              {t(LABEL_KEY[metric])}
            </Text>
          )}
          {data ? (
            <Text fontSize={20} weight={500}>
              {formatShortenNumber(data[metric])}
            </Text>
          ) : isLoading || !error ? (
            <Skeleton height={28} radius={6} width={48} />
          ) : (
            <AsyncError error={error} variant={'metric'} onRetry={() => void mutate()} />
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
};
