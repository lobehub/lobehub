import { type ModelRankItem } from '@lobechat/types';
import { BarList } from '@lobehub/charts';
import { ActionIcon } from '@lobehub/ui';
import { MaximizeIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ImperativeModal from '@/components/ImperativeModal';
import { ModelIcon } from '@/components/LobeIcons';
import { statsActions, statsSelectors, useStatsStore } from '@/store/stats';

import StatsFormGroup from '../components/StatsFormGroup';

export const TopicsRank = memo(() => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('auth');
  const { error, revalidate } = statsActions.useFetchRank('models');
  // A restored empty ranking stays unsettled until the server confirms it, so
  // a failed refresh surfaces the error instead of an endless loading state.
  const data = useStatsStore(statsSelectors.settledRank('models'));
  const loading = !data;

  const showExtra = Boolean(data && data?.length > 5);

  const mapData = (item: ModelRankItem) => {
    return {
      icon: <ModelIcon model={item.id as string} size={20} />,
      id: item.id,

      name: item.id,
      value: item.count,
    };
  };

  return (
    <>
      <StatsFormGroup
        fontSize={16}
        title={t('stats.modelsRank.title')}
        extra={
          showExtra ? (
            <ActionIcon icon={MaximizeIcon} size={'small'} onClick={() => setOpen(true)} />
          ) : undefined
        }
      >
        <AsyncBoundary
          data={data}
          error={error}
          errorVariant={'block'}
          onRetry={() => revalidate()}
        >
          <BarList
            data={data?.slice(0, 5).map((item) => mapData(item)) || []}
            height={220}
            leftLabel={t('stats.modelsRank.left')}
            loading={loading}
            rightLabel={t('stats.modelsRank.right')}
            noDataText={{
              desc: t('stats.empty.desc'),
              title: t('stats.empty.title'),
            }}
          />
        </AsyncBoundary>
      </StatsFormGroup>
      {showExtra && (
        <ImperativeModal
          footer={null}
          loading={loading}
          open={open}
          title={t('stats.modelsRank.title')}
          onCancel={() => setOpen(false)}
        >
          <BarList
            data={data?.map((item) => mapData(item)) || []}
            height={340}
            leftLabel={t('stats.modelsRank.left')}
            loading={loading}
            rightLabel={t('stats.modelsRank.right')}
          />
        </ImperativeModal>
      )}
    </>
  );
});

export default TopicsRank;
