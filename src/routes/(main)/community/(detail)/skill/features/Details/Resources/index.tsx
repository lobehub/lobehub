'use client';

import { Block, Empty, Flexbox, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import InlineTable from '@/components/InlineTable';

import { useDetailContext } from '../../DetailProvider';

type ResourceMeta = {
  fileHash?: string;
  size?: number;
};

type ResourceItem = ResourceMeta & {
  name: string;
};

const Resources = memo(() => {
  const { t } = useTranslation('discover');
  const { resources, github, homepage, repository } = useDetailContext();
  const repoUrl = homepage || github?.url || repository;

  const dataSource = useMemo<ResourceItem[]>(() => {
    return Object.entries((resources || {}) as Record<string, ResourceMeta>)
      .map(([name, meta]) => ({
        fileHash: meta?.fileHash,
        name,
        size: meta?.size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [resources]);

  const getResourceLink = (filePath: string) => {
    if (!repoUrl) return;
    const encodedPath = filePath
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return urlJoin(repoUrl, encodedPath);
  };

  if (dataSource.length === 0) {
    return (
      <Block variant={'outlined'}>
        <Empty description={t('skills.details.resources.empty')} />
      </Block>
    );
  }

  return (
    <Block style={{ overflow: 'hidden' }} variant={'outlined'}>
      <InlineTable
        dataSource={dataSource}
        pagination={false}
        rowKey={'name'}
        size={'middle'}
        columns={[
          {
            dataIndex: 'name',
            key: 'name',
            render: (text) => {
              const link = getResourceLink(text);
              const node = (
                <Flexbox horizontal align={'center'} gap={16}>
                  <MaterialFileTypeIcon
                    fallbackUnknownType={false}
                    filename={text}
                    size={24}
                    type={'file'}
                  />
                  <Text code style={{ wordBreak: 'break-all' }} type={'info'}>
                    {text}
                  </Text>
                </Flexbox>
              );
              if (!link) {
                return node;
              }

              return (
                <a href={link} rel={'noreferrer'} target={'_blank'}>
                  {node}
                </a>
              );
            },
            title: t('skills.details.resources.table.name'),
          },
          {
            align: 'end',
            dataIndex: 'size',
            key: 'size',
            render: (value) => {
              let size;

              if (typeof value !== 'number') {
                size = '--';
              } else if (value < 1024) {
                size = value + 'B';
              } else if (value < 1024 * 1024) {
                size = (value / 1024).toFixed(2) + 'KB';
              } else {
                size = (value / (1024 * 1024)).toFixed(2) + 'MB';
              }

              return (
                <Text code fontSize={13} type={'secondary'}>
                  {size}
                </Text>
              );
            },
            title: t('skills.details.resources.table.size'),
          },
        ]}
      />
    </Block>
  );
});

export default Resources;
