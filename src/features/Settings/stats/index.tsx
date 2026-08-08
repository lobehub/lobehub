'use client';

import { Flexbox, FormGroup, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { type DatePickerProps } from 'antd';
import { DatePicker, Divider } from 'antd';
import dayjs from 'dayjs';
import { Brain, UserIcon } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';

import {
  ShareButton,
  TotalAssistants,
  TotalMessages,
  TotalTokens,
  TotalTopics,
  Welcome,
} from './features/overview';
import { AssistantsRank, ModelsRank, TopicsRank } from './features/rankings';
import { UsageCards, UsageTable, UsageTrends } from './features/usage';
import { AiHeatmaps } from './features/visualization';
import { GroupBy, type UserDisplayResolver } from './types';

interface StatsSettingProps {
  enableUserDimension?: boolean;
  headerNode?: ReactNode | false;
  mobile?: boolean;
  resolveUser?: UserDisplayResolver;
  showSettingHeader?: boolean;
}

const StatsSetting = memo<StatsSettingProps>(
  ({ mobile, headerNode, enableUserDimension, resolveUser, showSettingHeader = true }) => {
    const { t, i18n } = useTranslation('auth');
    dayjs.locale(i18n.language);

    const [groupBy, setGroupBy] = useState<GroupBy>(GroupBy.Model);
    const [dateRange, setDateRange] = useState<dayjs.Dayjs>(dayjs(new Date()));
    const [dateStrings, setDateStrings] = useState<string>();

    const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.usageStat(), async () =>
      usageService.findAndGroupByDay(dateStrings),
    );

    useEffect(() => {
      if (dateStrings) {
        mutate();
      }
    }, [dateStrings]);

    const handleDateChange: DatePickerProps['onChange'] = (dates, dateStrings) => {
      const actualDate = Array.isArray(dates) ? dates[0] : dates;
      if (actualDate) {
        setDateRange(actualDate);
      }
      if (typeof dateStrings === 'string') {
        setDateStrings(dateStrings);
      }
    };

    const usageToolbar = (
      <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
        <DatePicker picker="month" value={dateRange} onChange={handleDateChange} />
        <Tabs
          activeKey={groupBy}
          style={{ marginLeft: 8 }}
          items={[
            {
              icon: <Icon icon={Brain} />,
              key: GroupBy.Model,
              label: t('usage.welcome.model'),
            },
            {
              icon: <Icon icon={ProviderIcon} />,
              key: GroupBy.Provider,
              label: t('usage.welcome.provider'),
            },
            ...(enableUserDimension
              ? [
                  {
                    icon: <Icon icon={UserIcon} />,
                    key: GroupBy.User,
                    label: t('usage.welcome.user'),
                  },
                ]
              : []),
          ]}
          onChange={(key) => setGroupBy(key as GroupBy)}
        />
      </Flexbox>
    );

    // 2×2 CSS grid for stat cards (matches mockup)
    const statGridStyle: React.CSSProperties = {
      display: 'grid',
      gap: 8,
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    };

    // Rankings container: full-width vertical layout
    const rankingsStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      width: '100%',
    };

    return (
      <>
        {showSettingHeader && <SettingHeader title={t('tab.stats')} />}
        {/* ========== Header Section ========== */}
        <FormGroup
          collapsible={false}
          extra={headerNode === undefined ? <ShareButton /> : undefined}
          gap={16}
          variant={'filled'}
          title={
            headerNode === undefined ? (
              <Welcome mobile={mobile} />
            ) : headerNode === false ? undefined : (
              headerNode
            )
          }
        >
          <div style={statGridStyle}>
            <TotalAssistants mobile={mobile} />
            <TotalTopics mobile={mobile} />
            <TotalMessages mobile={mobile} />
            <TotalTokens />
          </div>
          <Divider dashed />
          <AiHeatmaps mobile={mobile} />
          <Divider dashed />
          <div style={rankingsStyle}>
            <ModelsRank />
            <AssistantsRank mobile={mobile} />
            <TopicsRank mobile={mobile} />
          </div>
        </FormGroup>
        <FormGroup
          collapsible={false}
          gap={16}
          variant={'filled'}
          title={
            <Flexbox horizontal align={'center'} gap={8}>
              <span>{t('tab.usage')}</span>
              <span
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 8,
                  fontSize: 11,
                  padding: '2px 8px',
                }}
              >
                {dateRange.format('YYYY-MM')}
              </span>
            </Flexbox>
          }
        >
          {usageToolbar}
          <AsyncBoundary data={data} error={error} errorVariant={'block'} onRetry={() => mutate()}>
            <UsageCards
              data={data}
              groupBy={groupBy}
              isLoading={isLoading}
              mobile={mobile}
              resolveUser={resolveUser}
            />
            <Divider />
            <UsageTrends
              data={data}
              groupBy={groupBy}
              isLoading={isLoading}
              resolveUser={resolveUser}
            />
          </AsyncBoundary>
          <div style={{ height: 24 }} />
          <UsageTable dateStrings={dateStrings} />
        </FormGroup>
      </>
    );
  },
);

export default StatsSetting;
