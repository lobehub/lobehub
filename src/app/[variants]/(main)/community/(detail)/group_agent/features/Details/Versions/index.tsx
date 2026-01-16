import { Flexbox, Tag } from '@lobehub/ui';
import { Table, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import PublishedTime from '@/components/PublishedTime';
import { useDetailData } from '../../DetailProvider';

const { Title } = Typography;

const Versions = memo(() => {
  const { t } = useTranslation('discover');
  const params = useParams();
  const data = useDetailData();

  const { versions = [], group } = data;

  const columns = [
    {
      dataIndex: 'version',
      key: 'version',
      render: (version: string, record: any) => (
        <Flexbox gap={8} horizontal>
          <a
            href={`/community/group_agent/${params.slug}?version=${record.versionNumber}`}
            onClick={(e) => {
              e.preventDefault();
              window.location.href = `/community/group_agent/${params.slug}?version=${record.versionNumber}`;
            }}
          >
            {version}
          </a>
          {record.isLatest && (
            <Tag color="green">{t('versions.latest', { defaultValue: 'Latest' })}</Tag>
          )}
        </Flexbox>
      ),
      title: t('versions.version', { defaultValue: 'Version' }),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          archived: 'default',
          deprecated: 'red',
          published: 'green',
          unpublished: 'orange',
        };
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>;
      },
      title: t('versions.status', { defaultValue: 'Status' }),
    },
    {
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (date: string) => <PublishedTime date={date} template={'MMM DD, YYYY'} />,
      title: t('versions.publishedAt', { defaultValue: 'Published At' }),
    },
  ];

  return (
    <Flexbox gap={16}>
      <Title level={4}>
        {t('versions.title', { defaultValue: 'Version History' })} ({versions.length})
      </Title>

      <Table
        columns={columns}
        dataSource={versions}
        pagination={false}
        rowKey="versionNumber"
        size="small"
      />
    </Flexbox>
  );
});

export default Versions;
