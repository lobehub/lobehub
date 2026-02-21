import { Block, Empty, Highlighter, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';

import { useDetailContext } from '../DetailProvider';
import { styles } from './style';
import { ModeType } from './types';

const Resources = memo<{ mode?: ModeType }>(({ mode }) => {
  const { t } = useTranslation(['discover', 'plugin']);
  const { resources } = useDetailContext();

  if (!resources)
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('plugin:mcpEmpty.resources')}
          descriptionProps={{ fontSize: 14 }}
          icon={Database}
          style={{ maxWidth: 400 }}
        />
      </Block>
    );

  return mode === ModeType.Docs ? (
    <Block style={{ overflow: 'hidden' }} variant={'outlined'}>
      <InlineTable
        dataSource={resources}
        pagination={false}
        size={'middle'}
        columns={[
          {
            dataIndex: 'name',
            key: 'name',
            render: (text) => (
              <span className={styles.code} style={{ color: cssVar.gold }}>
                {text}
              </span>
            ),
            title: t('mcp.details.schema.resources.table.name'),
          },
          {
            dataIndex: 'mimeType',
            key: 'mimeType',
            render: (_, record) => <Tag className={styles.code}>{record.mimeType}</Tag>,
            title: t('mcp.details.schema.resources.table.mineType'),
          },
          {
            dataIndex: 'uri',
            key: 'uri',
            title: t('mcp.details.schema.resources.table.uri'),
          },
          {
            dataIndex: 'description',
            key: 'description',
            title: t('mcp.details.schema.resources.table.description'),
          },
        ]}
      />
    </Block>
  ) : (
    <Highlighter language={'json'} style={{ fontSize: 12 }} variant={'outlined'}>
      {JSON.stringify(resources, null, 2)}
    </Highlighter>
  );
});

export default Resources;
