'use client';

import type { FileSearchResult } from '@lobechat/types';
import { Center, Flexbox, MaterialFileTypeIcon, Text, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTheme } from 'next-themes';
import { memo } from 'react';

import { styles } from './style';

export interface FileItemProps extends FileSearchResult {
  index: number;
}

const FileItem = memo<FileItemProps>(({ fileId, fileName, relevanceScore }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      key={fileId}
      className={
        stylex.props(styles.container, isDarkMode ? styles.containerDark : styles.containerLight)
          .className
      }
    >
      <MaterialFileTypeIcon filename={fileName} size={20} type={'file'} variant={'raw'} />
      <Flexbox horizontal gap={12} justify={'space-between'} style={{ maxWidth: 200 }}>
        <Text ellipsis>{fileName}</Text>
        <Tooltip title={`Relevance: ${(relevanceScore * 100).toFixed(1)}%`}>
          <Center className={stylex.props(styles.badge).className}>
            {relevanceScore.toFixed(2)}
          </Center>
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
});

export default FileItem;
