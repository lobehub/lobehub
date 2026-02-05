import { Block, Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckIcon, MinusIcon } from 'lucide-react';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import Link from '@/libs/router/Link';
import { usePathname } from '@/libs/router/navigation';

import PublishedTime from '../../../../../../../../../components/PublishedTime';
import { useDetailContext } from '../../../../../../../../../features/MCPPluginDetail/DetailProvider';
import Title from '../../../../../features/Title';

const Versions = memo(() => {
  const { t } = useTranslation('discover');
  const { versions } = useDetailContext();
  const pathname = usePathname();
  return (
    <Flexbox gap={16}>
      <Title>{t('mcp.details.versions.title')}</Title>
      <Block variant={'outlined'}>
        <InlineTable
          dataSource={versions}
          rowKey={'version'}
          size={'middle'}
          columns={[
            {
              dataIndex: 'version',
              render: (_, record) => (
                <Link
                  style={{ color: 'inherit' }}
                  href={qs.stringifyUrl({
                    query: {
                      version: record.version,
                    },
                    url: pathname,
                  })}
                >
                  <Flexbox horizontal align={'center'} gap={8}>
                    <code style={{ fontSize: 14 }}>{record.version}</code>
                    {record.isLatest && (
                      <Tag color={'info'}>{t('mcp.details.versions.table.isLatest')}</Tag>
                    )}
                  </Flexbox>
                </Link>
              ),
              title: t('mcp.details.versions.table.version'),
            },
            {
              dataIndex: 'isValidated',
              render: (_, record) => (
                <Icon
                  color={record.isValidated ? cssVar.colorSuccess : cssVar.colorTextDescription}
                  icon={record.isValidated ? CheckIcon : MinusIcon}
                />
              ),
              title: t('mcp.details.versions.table.isValidated'),
            },
            {
              align: 'end',
              dataIndex: 'createdAt',
              render: (_, record) => <PublishedTime date={record.createdAt} showPrefix={false} />,
              title: t('mcp.details.versions.table.publishAt'),
            },
          ]}
        />
      </Block>
    </Flexbox>
  );
});

export default Versions;
