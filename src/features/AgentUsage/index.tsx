'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { StyleSheet } from '@/utils/styles';

import { groupByModel, summarizeUsage, useAgentUsage } from './hooks';
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

const AgentUsage = memo(() => {
  const { t } = useTranslation('setting');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const [month, setMonth] = useState<dayjs.Dayjs>(dayjs());
  const mo = month.format('YYYY-MM');

  const { data, isLoading } = useAgentUsage(activeAgentId ?? '', mo);

  const summary = useMemo(() => summarizeUsage(data), [data]);
  const modelRows = useMemo(() => groupByModel(data), [data]);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        left={
          <Text fontSize={16} weight={600}>
            {t('usageStats.title')}
          </Text>
        }
        right={
          <DatePicker
            allowClear={false}
            picker={'month'}
            value={month}
            onChange={(value) => value && setMonth(value)}
          />
        }
      />
      <Flexbox flex={1} style={styles.body} width={'100%'}>
        <WideScreenContainer>
          <Flexbox gap={24} paddingBlock={16}>
            <StatCards isLoading={isLoading} summary={summary} />
            <UsageTrendChart data={data} isLoading={isLoading} />
            <ModelBreakdown isLoading={isLoading} rows={modelRows} />
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentUsage;
