import { type HeatmapsProps } from '@lobehub/charts';
import { Heatmaps } from '@lobehub/charts';
import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FlameIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';

import StatsFormGroup from '../components/StatsFormGroup';

const AiHeatmaps = memo<
  Omit<HeatmapsProps, 'data' | 'ref'> & { inShare?: boolean; mobile?: boolean }
>(({ inShare, mobile, ...rest }) => {
  const { t } = useTranslation('auth');
  const { data, isLoading } = useClientDataSWR('stats-heatmaps', async () =>
    messageService.getHeatmaps(),
  );

  const days = data?.filter((item) => item.level > 0).length || '--';
  const hotDays = data?.filter((item) => item.level >= 3).length || '--';

  const content = (
    <Heatmaps
      blockMargin={mobile ? 3 : undefined}
      blockRadius={mobile ? 2 : undefined}
      blockSize={mobile ? 6 : 14}
      data={data || []}
      loading={isLoading || !data}
      maxLevel={4}
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
        tooltip: t('heatmaps.tooltip'),
        totalCount: t('heatmaps.totalCount'),
      }}
      style={{
        alignSelf: 'center',
      }}
      {...rest}
    />
  );

  const tags = (
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
          {tags}
        </Flexbox>
        {content}
      </Flexbox>
    );
  }

  return (
    <StatsFormGroup extra={tags} fontSize={16} title={t('stats.lastYearActivity')}>
      {content}
    </StatsFormGroup>
  );
});

export default AiHeatmaps;
