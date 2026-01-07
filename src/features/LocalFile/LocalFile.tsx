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
      align={'center'}
      className={styles.container}
      gap={4}
      horizontal
      onClick={isDirectory ? handleOpenFile : undefined}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
    >
      <FileIcon fileName={name} isDirectory={isDirectory} size={22} variant={'raw'} />
      <Flexbox align={'baseline'} gap={4} horizontal style={{ overflow: 'hidden', width: '100%' }}>
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
        onClick={handleOpenFile}
        size="small"
        title={t('LocalFile.action.open')}
      >
        {t('LocalFile.action.open')}
      </Button>
      <Button
        icon={FolderOpen}
        onClick={handleOpenFolder}
        size="small"
        title={t('LocalFile.action.showInFolder')}
      >
        {t('LocalFile.action.showInFolder')}
      </Button>
    </Space.Compact>
  );

  return (
    <Popover
      content={popoverContent}
      styles={{
        content: { padding: 0 },
      }}
      trigger="hover"
    >
      {fileContent}
    </Popover>
  );
};
