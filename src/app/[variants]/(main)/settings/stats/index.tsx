'use client';

import { FormGroup, Grid, Icon, Segmented } from '@lobehub/ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { type DatePickerProps } from 'antd';
import { DatePicker, Divider } from 'antd';
import dayjs from 'dayjs';
import { Brain } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';

import {
  ShareButton,
  TotalAssistants,
  TotalMessages,
  TotalTopics,
  TotalWords,
  Welcome,
} from './features/overview';
import { AssistantsRank, ModelsRank, TopicsRank } from './features/rankings';
import { UsageCards, UsageTable, UsageTrends } from './features/usage';
import { AiHeatmaps } from './features/visualization';
import { GroupBy } from './types';

const StatsSetting = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t, i18n } = useTranslation('auth');
  dayjs.locale(i18n.language);

  const [groupBy, setGroupBy] = useState<GroupBy>(GroupBy.Model);
  const [dateRange, setDateRange] = useState<dayjs.Dayjs>(dayjs(new Date()));
  const [dateStrings, setDateStrings] = useState<string>();

  const { data, isLoading, mutate } = useClientDataSWR('usage-stat', async () =>
    usageService.findAndGroupByDay(dateStrings),
  );

  useEffect(() => {
    if (dateStrings) {
      mutate();
    }
  }, [dateStrings]);

  const handleDateChange: DatePickerProps['onChange'] = (dates, dateStrings) => {
    // Handle both single date and array
    const actualDate = Array.isArray(dates) ? dates[0] : dates;
    if (actualDate) {
      setDateRange(actualDate);
    }
    if (typeof dateStrings === 'string') {
      setDateStrings(dateStrings);
    }
  };

  return (
    <>
      <SettingHeader title={t('tab.stats')} />
      {/* ========== Header Section ========== */}
      <FormGroup
        collapsible={false}
        extra={<ShareButton />}
        gap={16}
        title={<Welcome mobile={mobile} />}
        variant={'filled'}
      >
        <Grid gap={8} maxItemWidth={150} rows={4}>
          <TotalAssistants mobile={mobile} />
          <TotalTopics mobile={mobile} />
          <TotalMessages mobile={mobile} />
          <TotalWords />
        </Grid>
        <Divider dashed />
        <AiHeatmaps mobile={mobile} />
        <Divider dashed />
        <Grid gap={16} rows={3} style={{ paddingBottom: 12 }}>
          <ModelsRank />
          <AssistantsRank mobile={mobile} />
          <TopicsRank mobile={mobile} />
        </Grid>
      </FormGroup>
      <FormGroup
        collapsible={false}
        gap={16}
        title={t('tab.usage')}
        variant={'filled'}
        extra={
          <>
            <DatePicker picker="month" value={dateRange} onChange={handleDateChange} />
            <Segmented
              style={{ marginLeft: 8 }}
              value={groupBy}
              variant={'outlined'}
              options={[
                {
                  icon: <Icon icon={Brain} />,
                  label: t('usage.welcome.model'),
                  value: GroupBy.Model,
                },
                {
                  icon: <Icon icon={ProviderIcon} />,
                  label: t('usage.welcome.provider'),
                  value: GroupBy.Provider,
                },
              ]}
              onChange={(v) => setGroupBy(v as GroupBy)}
            />
          </>
        }
        styles={{
          title: { lineHeight: '35px' },
        }}
      >
        <UsageCards data={data} groupBy={groupBy} isLoading={isLoading} />
        <Divider />
        <UsageTrends data={data} groupBy={groupBy} isLoading={isLoading} />
        <div style={{ height: 24 }} />
        <UsageTable dateStrings={dateStrings} />
      </FormGroup>
    </>
  );
});

export default StatsSetting;
