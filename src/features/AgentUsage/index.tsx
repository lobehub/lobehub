'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { type AgentUsageGranularity } from '@/types/usage/usageRecord';
import { StyleSheet } from '@/utils/styles';

import { RANGE_DAYS, type TimeRange, useAgentUsageStats } from './hooks';
import ModelBreakdown from './ModelBreakdown';
import StatCards from './StatCards';
import UsageTrendChart from './UsageTrendChart';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

const EMPTY_SUMMARY = {
  cacheHitRate: 0,
  cacheReadTokens: 0,
  cacheSavings: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalCost: 0,
  totalRequests: 0,
  totalTokens: 0,
};

const AgentUsage = memo(() => {
  const { t } = useTranslation('spend');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<AgentUsageGranularity>('day');

  const handleGranularityChange = (nextGranularity: AgentUsageGranularity) => {
    setGranularity(nextGranularity);
    if (nextGranularity === 'week' && range === '7d') setRange('30d');
  };

  const { data, isLoading, error, mutate } = useAgentUsageStats(
    activeAgentId ?? '',
    range,
    granularity,
  );

  const rangeLabel = t('usageStats.rangeSuffix', { count: RANGE_DAYS[range] });

  // A metrics surface's failure default is a *zero-valued object*, not an empty
  // array — coercing `data?.summary ?? EMPTY_SUMMARY` renders a confident
  // "$0.00 / 0 tokens" dashboard on a 500 / offline / auth failure, indistinguishable
  // from an agent that genuinely never ran. Read `error` and, when nothing loaded,
  // render a failed metric marker + Reload instead of any aggregate. `!error` keeps
  // the genuine-zero (real empty) and real-data states as before. Gate on `!data`
  // so a background revalidate error never wipes already-shown numbers.
  const showError = !!error && !data;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeAgentId ? (
            <AgentBreadcrumb agentId={activeAgentId} title={t('usageStats.title')} />
          ) : null
        }
      />
      <Flexbox flex={1} style={styles.body} width={'100%'}>
        <WideScreenContainer>
          <Flexbox gap={16} paddingBlock={16}>
            <Block gap={16} padding={20} variant={'outlined'}>
              <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={13} type={'secondary'}>
                    {t('usageStats.dimension')}
                  </Text>
                  <Segmented
                    size={'small'}
                    value={granularity}
                    options={[
                      { label: t('usageStats.byDay'), value: 'day' },
                      { label: t('usageStats.byWeek'), value: 'week' },
                    ]}
                    onChange={(v) => handleGranularityChange(v as AgentUsageGranularity)}
                  />
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text fontSize={13} type={'secondary'}>
                    {t('usageStats.range')}
                  </Text>
                  <Segmented
                    size={'small'}
                    value={range}
                    options={
                      granularity === 'week'
                        ? [
                            { label: '30d', value: '30d' },
                            { label: '90d', value: '90d' },
                          ]
                        : [
                            { label: '7d', value: '7d' },
                            { label: '30d', value: '30d' },
                            { label: '90d', value: '90d' },
                          ]
                    }
                    onChange={(v) => setRange(v as TimeRange)}
                  />
                </Flexbox>
              </Flexbox>
              {showError ? (
                <AsyncError error={error} variant={'metric'} onRetry={() => mutate()} />
              ) : (
                <StatCards
                  isLoading={isLoading}
                  rangeLabel={rangeLabel}
                  summary={data?.summary ?? EMPTY_SUMMARY}
                />
              )}
            </Block>
            {!showError && (
              <>
                <Block padding={20} variant={'outlined'}>
                  <UsageTrendChart buckets={data?.buckets} isLoading={isLoading} />
                </Block>
                <Block padding={20} variant={'outlined'}>
                  <ModelBreakdown isLoading={isLoading} rows={data?.byModel ?? []} />
                </Block>
              </>
            )}
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentUsage;
