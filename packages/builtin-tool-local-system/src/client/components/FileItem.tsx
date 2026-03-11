import type { LocalFileItem } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { FolderOpen } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';
import { formatSize } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border-radius: 4px;
    color: ${cssVar.colorTextSecondary};

    :hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  path: css`
    overflow: hidden;

    font-size: 10px;
    line-height: 1;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  size: css`
    min-width: 50px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
    text-align: end;
  `,
  title: css`
    overflow: hidden;
    display: block;

    color: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface FileItemProps extends LocalFileItem {
  showTime?: boolean;
}
const FileItem = memo<FileItemProps>(
  ({ isDirectory, name, path, size, type, showTime = false, createdTime }) => {
    const { t } = useTranslation('tool');
    const [isHovering, setIsHovering] = useState(false);

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.container}
        gap={12}
        padding={'2px 8px'}
        style={{ cursor: 'pointer', fontSize: 12, width: '100%' }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={() => {
          localFileService.openLocalFileOrFolder(path, isDirectory);
        }}
      >
        <FileIcon
          fileName={name}
          fileType={type}
          isDirectory={isDirectory}
          size={16}
          variant={'raw'}
        />
        <Flexbox
          horizontal
          align={'baseline'}
          gap={4}
          style={{ overflow: 'hidden', width: '100%' }}
        >
          <div className={styles.title}>{name}</div>
          {showTime ? (
            <div className={styles.path}>{dayjs(createdTime).format('MMM DD hh:mm')}</div>
          ) : (
            <div className={styles.path}>{path}</div>
          )}
        </Flexbox>
        {isHovering ? (
          <Flexbox direction={'horizontal-reverse'} gap={8} style={{ minWidth: 50 }}>
            <ActionIcon
              icon={FolderOpen}
              size={'small'}
              style={{ height: 16, width: 16 }}
              title={t('localFiles.openFolder')}
              onClick={(e) => {
                e.stopPropagation();
                localFileService.openLocalFolder({ isDirectory, path });
              }}
            />
          </Flexbox>
        ) : (
          <span className={styles.size}>{formatSize(size)}</span>
        )}
      </Flexbox>
    );
  },
);

export default FileItem;
