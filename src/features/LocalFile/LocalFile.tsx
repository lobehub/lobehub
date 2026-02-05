import { Button, Flexbox, Popover } from '@lobehub/ui';
import { Space } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLink, FolderOpen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    padding-block: 2px;
    padding-inline: 4px 8px;
    border-radius: 4px;

    color: ${cssVar.colorText};

    :hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    overflow: hidden;
    display: block;

    line-height: 20px;
    color: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface LocalFileProps {
  isDirectory?: boolean;
  name: string;
  path?: string;
}

export const LocalFile = ({ name, path, isDirectory = false }: LocalFileProps) => {
  const { t } = useTranslation('components');

  const handleOpenFile = () => {
    if (!path) return;
    localFileService.openLocalFileOrFolder(path, isDirectory);
  };

  const handleOpenFolder = () => {
    if (!path) return;
    localFileService.openFileFolder(path);
  };

  const fileContent = (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={4}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
      onClick={isDirectory ? handleOpenFile : undefined}
    >
      <FileIcon fileName={name} isDirectory={isDirectory} size={22} variant={'raw'} />
      <Flexbox horizontal align={'baseline'} gap={4} style={{ overflow: 'hidden', width: '100%' }}>
        <div className={styles.title}>{name}</div>
      </Flexbox>
    </Flexbox>
  );

  // Directory: no popover, just click to open
  if (isDirectory) {
    return fileContent;
  }

  // File: show popover with two actions
  const popoverContent = (
    <Space.Compact>
      <Button
        icon={ExternalLink}
        size="small"
        title={t('LocalFile.action.open')}
        onClick={handleOpenFile}
      >
        {t('LocalFile.action.open')}
      </Button>
      <Button
        icon={FolderOpen}
        size="small"
        title={t('LocalFile.action.showInFolder')}
        onClick={handleOpenFolder}
      >
        {t('LocalFile.action.showInFolder')}
      </Button>
    </Space.Compact>
  );

  return (
    <Popover
      content={popoverContent}
      trigger="hover"
      styles={{
        content: { padding: 0 },
      }}
    >
      {fileContent}
    </Popover>
  );
};
