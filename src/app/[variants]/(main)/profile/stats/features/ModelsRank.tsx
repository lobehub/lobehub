import { ModelRankItem } from '@lobechat/types';
import { BarList } from '@lobehub/charts';
import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, FormGroup, Modal } from '@lobehub/ui';
import { MaximizeIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';

export const TopicsRank = memo(() => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('auth');
  const { data, isLoading } = useClientDataSWR('rank-models', async () =>
    messageService.rankModels(),
  );

  const showExtra = Boolean(data && data?.length > 5);

  const mapData = (item: ModelRankItem) => {
    return {
      icon: <ModelIcon model={item.id as string} size={24} />,
      id: item.id,

      name: item.id,
      value: item.count,
    };
  };

  return (
    <>
      <FormGroup
        extra={
          showExtra ? (
            <ActionIcon
              icon={MaximizeIcon}
              onClick={() => setOpen(true)}
              size={{ blockSize: 28, size: 20 }}
            />
          ) : undefined
        }
        style={FORM_STYLE.style}
        title={t('stats.modelsRank.title')}
        variant={'borderless'}
      >
        <Flexbox horizontal paddingBlock={16}>
          <BarList
            data={data?.slice(0, 5).map((item) => mapData(item)) || []}
            height={220}
            leftLabel={t('stats.modelsRank.left')}
            loading={isLoading || !data}
            noDataText={{
              desc: t('stats.empty.desc'),
              title: t('stats.empty.title'),
            }}
            rightLabel={t('stats.modelsRank.right')}
          />
        </Flexbox>
      </FormGroup>
      {showExtra && (
        <Modal
          footer={null}
          loading={isLoading || !data}
          onCancel={() => setOpen(false)}
          open={open}
          title={t('stats.modelsRank.title')}
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
