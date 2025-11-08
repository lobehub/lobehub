'use client';

import { ActionIcon, Icon, Tag } from '@lobehub/ui';
import { Descriptions, Divider } from 'antd';
import { useTheme } from 'antd-style';
import dayjs from 'dayjs';
import { BoltIcon, DownloadIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FileListItem } from '@/types/files';
import { downloadFile } from '@/utils/client/downloadFile';
import { formatSize } from '@/utils/format';

export const DETAIL_PANEL_WIDTH = 300;

const FileDetail = memo<FileListItem>((props) => {
  const { name, embeddingStatus, size, createdAt, updatedAt, chunkCount, url } = props || {};
  const { t } = useTranslation('file');
  const theme = useTheme();

  if (!props) return null;

  const items = [
    { children: name, key: 'name', label: t('detail.basic.filename') },
    { children: formatSize(size), key: 'size', label: t('detail.basic.size') },
    {
      children: name.split('.').pop()?.toUpperCase(),
      key: 'type',
      label: t('detail.basic.type'),
    },

    {
      children: dayjs(createdAt).format('YYYY-MM-DD HH:mm'),
      key: 'createdAt',
      label: t('detail.basic.createdAt'),
    },
    {
      children: dayjs(updatedAt).format('YYYY-MM-DD HH:mm'),
      key: 'updatedAt',
      label: t('detail.basic.updatedAt'),
    },
  ];

  const dataItems = [
    {
      children: (
        <Tag bordered={false} icon={<Icon icon={BoltIcon} />}>
          {' '}
          {chunkCount}
        </Tag>
      ),
      key: 'chunkCount',
      label: t('detail.data.chunkCount'),
    },
    {
      children: (
        <Tag bordered={false} color={embeddingStatus || 'default'}>
          {t(`detail.data.embedding.${embeddingStatus || 'default'}`)}
        </Tag>
      ),
      key: 'embeddingStatus',
      label: t('detail.data.embeddingStatus'),
    },
  ];

  return (
    <Flexbox
      padding={16}
      style={{ borderInlineStart: `1px solid ${theme.colorSplit}` }}
      width={DETAIL_PANEL_WIDTH}
    >
      <Descriptions
        colon={false}
        column={1}
        extra={
          url && (
            <ActionIcon
              icon={DownloadIcon}
              onClick={() => {
                downloadFile(url, name);
              }}
              title={t('download', { ns: 'common' })}
            />
          )
        }
        items={items}
        labelStyle={{ width: 120 }}
        size={'small'}
        title={t('detail.basic.title')}
      />
      <Divider />
      <Descriptions
        colon={false}
        column={1}
        items={dataItems}
        labelStyle={{ width: 120 }}
        size={'small'}
      />
    </Flexbox>
  );
});

export default FileDetail;
