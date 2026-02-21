import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import path from 'path-browserify-esm';
import React from 'react';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    padding-block: 2px;
    padding-inline: 4px 8px;
    border-radius: 4px;

    color: ${cssVar.colorTextSecondary};

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

interface LocalFolderProps {
  path: string;
  size?: number;
}

export const LocalFolder = ({ path: pathname, size = 22 }: LocalFolderProps) => {
  const handleClick = () => {
    if (!path) return;

    localFileService.openLocalFolder({ isDirectory: true, path: pathname });
  };

  const { base } = path.parse(pathname);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={4}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
      onClick={handleClick}
    >
      <FileIcon isDirectory fileName={base} size={size} variant={'raw'} />
      <Flexbox horizontal align={'baseline'} gap={4} style={{ overflow: 'hidden', width: '100%' }}>
        <div className={styles.title}>{base}</div>
      </Flexbox>
    </Flexbox>
  );
};
