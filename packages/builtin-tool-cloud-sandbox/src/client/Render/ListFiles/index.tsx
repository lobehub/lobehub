'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { File, Folder } from 'lucide-react';
import { memo } from 'react';

import type { ListLocalFilesState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  fileIcon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  fileItem: css`
    cursor: default;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  folderIcon: css`
    color: ${cssVar.colorWarning};
  `,
}));

interface ListLocalFilesParams {
  directoryPath: string;
}

/**
 * Format file size to human readable string
 */
const formatSize = (bytes?: number): string => {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const ListFiles = memo<BuiltinRenderProps<ListLocalFilesParams, ListLocalFilesState>>(
  ({ args, pluginState }) => {
    if (!pluginState?.files) {
      return null;
    }

    // Sort: directories first, then files, both alphabetically
    const sortedFiles = [...pluginState.files].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <Flexbox className={styles.container} gap={8}>
        {/* Directory path */}
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text code ellipsis as={'span'} fontSize={12}>
            📁 {args.directoryPath}
          </Text>
          <Text code as={'span'} fontSize={11} type={'secondary'}>
            {pluginState.files.length} items
          </Text>
        </Flexbox>

        {/* File list */}
        <Block padding={8} style={{ maxHeight: 300, overflow: 'auto' }} variant={'outlined'}>
          <Flexbox gap={2}>
            {sortedFiles.map((file, index) => (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.fileItem}
                justify={'space-between'}
                key={index}
              >
                <Flexbox horizontal align={'center'} gap={8}>
                  {file.isDirectory ? (
                    <Folder className={styles.folderIcon} size={14} />
                  ) : (
                    <File className={styles.fileIcon} size={14} />
                  )}
                  <Text code as={'span'} fontSize={12}>
                    {file.name}
                  </Text>
                </Flexbox>
                {!file.isDirectory && file.size !== undefined && (
                  <Text code as={'span'} fontSize={11} type={'secondary'}>
                    {formatSize(file.size)}
                  </Text>
                )}
              </Flexbox>
            ))}
          </Flexbox>
        </Block>
      </Flexbox>
    );
  },
);

ListFiles.displayName = 'ListFiles';

export default ListFiles;
