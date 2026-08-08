import { type HeatmapsProps } from '@lobehub/charts';
import { Heatmaps } from '@lobehub/charts';
import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CoinsIcon, FlameIcon, MessageSquareIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { formatIntergerNumber, formatShortenNumber } from '@/utils/format';

import { HeatmapType } from '../../types';
import StatsFormGroup from '../components/StatsFormGroup';
import HeatmapStats from './HeatmapStats';

const AiHeatmaps = memo<
  Omit<HeatmapsProps, 'data' | 'ref'> & { inShare?: boolean; mobile?: boolean }
>(({ inShare, mobile, ...rest }) => {
  const { t } = useTranslation('auth');
  const [type, setType] = useState<HeatmapType>(
    inShare ? HeatmapType.Messages : HeatmapType.Tokens,
  );
  const isTokens = type === HeatmapType.Tokens;

  const { data, isLoading } = useClientDataSWR(statsKeys.heatmaps(type), async () =>
    isTokens ? messageService.getTokenHeatmaps() : messageService.getHeatmaps(),
  );

  const days = data?.filter((item) => item.level > 0).length || '--';
  const hotDays = data?.filter((item) => item.level >= 3).length || '--';

  const content = (
    <Heatmaps
      blockMargin={mobile ? 3 : undefined}
      blockRadius={mobile ? 2 : undefined}
      blockSize={mobile ? 6 : 14}
      data={data || []}
      hideTotalCount={isTokens}
      loading={isLoading || !data}
      maxLevel={4}
      customTooltip={(activity) =>
        t(isTokens ? 'heatmaps.tooltipTokens' : 'heatmaps.tooltip', {
          count: isTokens
            ? formatShortenNumber(activity.count)
            : formatIntergerNumber(activity.count),
          date: activity.date,
        })
      }
      labels={{
        legend: {
          less: t('heatmaps.legend.less'),
          more: t('heatmaps.legend.more'),
        },
        months: [
          t('heatmaps.months.jan'),
          t('heatmaps.months.feb'),
          t('heatmaps.months.mar'),
          t('heatmaps.months.apr'),
          t('heatmaps.months.may'),
          t('heatmaps.months.jun'),
          t('heatmaps.months.jul'),
          t('heatmaps.months.aug'),
          t('heatmaps.months.sep'),
          t('heatmaps.months.oct'),
          t('heatmaps.months.nov'),
          t('heatmaps.months.dec'),
        ],
        tooltip: isTokens ? t('heatmaps.tooltipTokens') : t('heatmaps.tooltip'),
        totalCount: isTokens ? t('heatmaps.totalCountTokens') : t('heatmaps.totalCount'),
      }}
      style={{
        alignSelf: 'center',
      }}
      {...rest}
    />
  );

  const typeSwitch = (
    <Tabs
      activeKey={type}
      size={'small'}
      style={{ width: 'auto' }}
      items={[
        {
          icon: <Icon icon={CoinsIcon} />,
          key: HeatmapType.Tokens,
          label: t('stats.tokens'),
        },
        {
          icon: <Icon icon={MessageSquareIcon} />,
          key: HeatmapType.Messages,
          label: t('stats.messages'),
        },
      ]}
      onChange={(key) => setType(key as HeatmapType)}
    />
  );

  const dayTags = (
    <Flexbox horizontal gap={8}>
      <Tag variant={'filled'}>{[days, t('stats.days')].join(' ')}</Tag>
      <Tag color={'success'} icon={<Icon icon={FlameIcon} />} variant={'filled'}>
        {[hotDays, t('stats.days')].join(' ')}
      </Tag>
    </Flexbox>
  );

  if (inShare) {
    return (
      <Flexbox gap={4}>
        <Flexbox horizontal align={'baseline'} gap={4} justify={'space-between'}>
          <div
            style={{
              color: cssVar.colorTextDescription,
              fontSize: 12,
            }}
          >
            {t('stats.lastYearActivity')}
          </div>
          {dayTags}
        </Flexbox>
        {content}
      </Flexbox>
    );
  }

  return (
    <StatsFormGroup
      afterTitle={typeSwitch}
      extra={dayTags}
      fontSize={16}
      title={t('stats.lastYearActivity')}
    >
      <HeatmapStats />
      {content}
    </StatsFormGroup>
  );
});

export default AiHeatmaps;
