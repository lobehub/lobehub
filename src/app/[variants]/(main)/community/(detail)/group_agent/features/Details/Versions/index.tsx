import { Block, Flexbox, Icon, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import PublishedTime from '@/components/PublishedTime';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

const Versions = memo(() => {
  const { t } = useTranslation('discover');
  const { versions = [], currentVersion } = useDetailContext();

  const statusTagMap = useMemo(
    () => ({
      archived: {
        color: 'default' as const,
        label: t('groupAgents.details.version.status.archived', { defaultValue: 'Archived' }),
      },
      deprecated: {
        color: 'warning' as const,
        label: t('groupAgents.details.version.status.deprecated', { defaultValue: 'Deprecated' }),
      },
      published: {
        color: 'success' as const,
        label: t('groupAgents.details.version.status.published', { defaultValue: 'Published' }),
      },
      unpublished: {
        color: 'default' as const,
        label: t('groupAgents.details.version.status.unpublished', { defaultValue: 'Unpublished' }),
      },
    }),
    [t],
  );

  if (!versions.length) {
    return (
      <Flexbox gap={16}>
        <Title>
          {t('groupAgents.details.version.title', { defaultValue: 'Version History' })}
        </Title>
        <Block padding={24} variant={'outlined'}>
          {t('groupAgents.details.version.empty', { defaultValue: 'No version history available' })}
        </Block>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      <Title>
        {t('groupAgents.details.version.title', { defaultValue: 'Version History' })}
      </Title>
      <Block variant={'outlined'}>
        <InlineTable
          dataSource={versions}
          rowKey={'version'}
          size={'middle'}
          columns={[
            {
              dataIndex: 'version',
              render: (_: any, record: any) => {
                const statusKey =
                  record.status &&
                  Object.prototype.hasOwnProperty.call(statusTagMap, record.status)
                    ? (record.status as keyof typeof statusTagMap)
                    : undefined;
                const statusMeta = statusKey ? statusTagMap[statusKey] : undefined;

                return (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <code style={{ fontSize: 14 }}>{record.version}</code>
                    {(record.isLatest || record.version === currentVersion) && (
                      <Tag color={'info'}>
                        {t('groupAgents.details.version.table.isLatest', { defaultValue: 'Latest' })}
                      </Tag>
                    )}
                    {statusMeta && <Tag color={statusMeta.color}>{statusMeta.label}</Tag>}
                  </Flexbox>
                );
              },
              title: t('groupAgents.details.version.table.version', { defaultValue: 'Version' }),
            },
            {
              align: 'center',
              dataIndex: 'isValidated',
              render: (_: any, record: any) => (
                <Icon
                  color={record.isValidated ? cssVar.colorSuccess : cssVar.colorTextDescription}
                  icon={record.isValidated ? CheckIcon : MinusIcon}
                />
              ),
              title: t('groupAgents.details.version.table.isValidated', {
                defaultValue: 'Validated',
              }),
            },
            {
              align: 'end',
              dataIndex: 'createdAt',
              render: (_: any, record: any) => (
                <PublishedTime date={record.createdAt} showPrefix={false} />
              ),
              title: t('groupAgents.details.version.table.publishAt', {
                defaultValue: 'Published At',
              }),
            },
          ]}
        />
      </Block>
    </Flexbox>
  );
});

Versions.displayName = 'GroupAgentVersions';

export default Versions;
