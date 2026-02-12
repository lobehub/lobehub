import { type ModelRankItem } from '@lobechat/types';
import { BarList } from '@lobehub/charts';
import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, Modal } from '@lobehub/ui';
import { MaximizeIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';

import StatsFormGroup from '../components/StatsFormGroup';

export const TopicsRank = memo(() => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('auth');
  const { data, isLoading } = useClientDataSWR('rank-models', async () =>
    messageService.rankModels(),
  );

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
        <BarList
          data={data?.slice(0, 5).map((item) => mapData(item)) || []}
          height={220}
          leftLabel={t('stats.modelsRank.left')}
          loading={isLoading || !data}
          rightLabel={t('stats.modelsRank.right')}
          noDataText={{
            desc: t('stats.empty.desc'),
            title: t('stats.empty.title'),
          }}
        />
      </StatsFormGroup>
      {showExtra && (
        <Modal
          footer={null}
          loading={isLoading || !data}
          open={open}
          title={t('stats.modelsRank.title')}
          onCancel={() => setOpen(false)}
        >
          <BarList
            data={data?.map((item) => mapData(item)) || []}
            height={340}
            leftLabel={t('stats.modelsRank.left')}
            loading={isLoading || !data}
            rightLabel={t('stats.modelsRank.right')}
          />
        </Modal>
      )}
    </>
  );
});

export default TopicsRank;
