import { Empty, Flexbox } from '@lobehub/ui';
import { Table } from 'antd';
import isEqual from 'fast-deep-equal';
import { Wrench } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const APIs = memo<{
  id: string;
}>(({ id }) => {
  const { t } = useTranslation('plugin');
  const pluginManifest = useToolStore(pluginSelectors.getToolManifestById(id), isEqual);

  if (!pluginManifest?.api)
    return (
      <Empty
        description={t('detailModal.info.description')}
        descriptionProps={{ fontSize: 14 }}
        icon={Wrench}
        style={{ maxWidth: 400 }}
      />
    );

  return (
    <Flexbox paddingBlock={16} width={'100%'}>
      <Table
        bordered
        dataSource={pluginManifest.api}
        pagination={false}
        rowKey={'name'}
        size={'small'}
        tableLayout="fixed"
        columns={[
          {
            dataIndex: 'name',
            render: (name: string) => <code>{name}</code>,
            title: t('detailModal.info.name'),
          },
          {
            dataIndex: 'description',
            title: t('detailModal.info.description'),
          },
        ]}
      />
    </Flexbox>
  );
});

export default APIs;
