'use client';

import { FileSearchResult } from '@lobechat/types';
import { Center, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cx, useThemeMode } from 'antd-style';
import { ComponentType, memo } from 'react';

import { styles } from './style';

export interface FileItemProps extends FileSearchResult {
  FileIcon: ComponentType<{
    fileName: string;
    size: number;
    variant?: 'raw' | 'file' | 'folder';
  }>;
  index: number;
  isMobile?: boolean;
  onFileClick?: (params: { chunkId: string; chunkText: string; fileId: string }) => void;
}

const FileItem = memo<FileItemProps>(
  ({ fileId, fileName, relevanceScore, topChunks, FileIcon, isMobile, onFileClick }) => {
    const { isDarkMode } = useThemeMode();

    // Use the first chunk for preview
    const firstChunk = topChunks[0];

    return (
      <Flexbox
        align={'center'}
        className={cx(
          styles.container,
          isDarkMode ? styles.containerDark : styles.containerLight,
          isMobile && styles.mobile,
        )}
        gap={4}
        horizontal
        key={fileId}
        onClick={(e) => {
          e.stopPropagation();
          if (firstChunk && onFileClick) {
            onFileClick({
              chunkId: firstChunk.id,
              chunkText: firstChunk.text,
              fileId,
            });
          }
        }}
      >
        <FileIcon fileName={fileName} size={20} variant={'raw'} />
        <Flexbox gap={12} horizontal justify={'space-between'} style={{ maxWidth: 200 }}>
          <Text ellipsis>{fileName}</Text>
          <Tooltip title={`Relevance: ${(relevanceScore * 100).toFixed(1)}%`}>
            <Center className={styles.badge}>{relevanceScore.toFixed(2)}</Center>
          </Tooltip>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default FileItem;
