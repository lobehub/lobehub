import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { FolderOpen } from 'lucide-react';
import nodePath from 'path-browserify-esm';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
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
  dir: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 1.3;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  size: css`
    flex-shrink: 0;

    min-width: 56px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-align: end;
  `,
  time: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 1;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;
    display: block;

    line-height: 1.3;
    color: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface FileItemProps {
  createdTime?: Date | string;
  isDirectory?: boolean;
  name?: string;
  path?: string;
  showTime?: boolean;
  size?: number;
  type?: string;
}

const FileItem = memo<FileItemProps>(
  ({ isDirectory, name: nameProp, path, size, type, showTime = false, createdTime }) => {
    const { t } = useTranslation('tool');
    const { openFile, openFolder, displayRelativePath } = useToolRenderCapabilities();
    const name = nameProp || path?.split('/').pop() || '';

    // Display the parent directory only — the filename is already shown above,
    // and the full path repeats it. Collapse $HOME to "~" when we have access
    // to the desktop state, so paths like `/Users/foo/Downloads/x` render as
    // `~/Downloads/x` and stay legible.
    const parentDir = useMemo(() => {
      if (!path || isDirectory) return '';
      const dir = nodePath.dirname(path);
      if (!dir || dir === '.' || dir === '/') return dir;
      return displayRelativePath?.(dir) ?? dir;
    }, [path, isDirectory, displayRelativePath]);

    const handleRowClick = () => {
      if (!path) return;
      if (isDirectory) openFolder?.(path);
      else openFile?.(path);
    };

    const handleOpenFolder = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (path) openFolder?.(path);
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.container}
        gap={12}
        padding={'4px 8px'}
        style={{
          cursor: openFile || openFolder ? 'pointer' : 'default',
          fontSize: 12,
          width: '100%',
        }}
        onClick={handleRowClick}
      >
        <FileIcon
          fileName={name || ''}
          fileType={type}
          isDirectory={isDirectory}
          size={20}
          variant={'raw'}
        />
        <Flexbox flex={1} gap={2} style={{ overflow: 'hidden', minWidth: 0 }}>
          <div className={styles.title}>{name}</div>
          {showTime ? (
            createdTime && (
              <div className={styles.time}>{dayjs(createdTime).format('MMM DD hh:mm')}</div>
            )
          ) : parentDir ? (
            <div className={styles.dir}>{parentDir}</div>
          ) : null}
        </Flexbox>
        {size !== undefined && <span className={styles.size}>{formatSize(size)}</span>}
        {!isDirectory && openFolder && path && (
          <ActionIcon
            icon={FolderOpen}
            size={'small'}
            style={{ height: 24, width: 24 }}
            title={t('localFiles.openFolder')}
            onClick={handleOpenFolder}
          />
        )}
      </Flexbox>
    );
  },
);

export default FileItem;
