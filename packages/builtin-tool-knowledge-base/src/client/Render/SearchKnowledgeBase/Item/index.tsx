'use client';

import type { FileSearchResult } from '@lobechat/types';
import { Center, Flexbox, MaterialFileTypeIcon, Tooltip, Text, cx } from '@lobehub/ui';
import { useTheme } from 'next-themes';
import { memo } from 'react';

import { styles } from './style';

export interface FileItemProps extends Pick<FileSearchResult, 'fileName'> {
  /** Vector similarity. Full-text hits rank on a different scale, so they show no score. */
  relevanceScore?: number;
}

const FileItem = memo<FileItemProps>(({ fileName, relevanceScore }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.container, isDarkMode ? styles.containerDark : styles.containerLight)}
      gap={4}
    >
      <MaterialFileTypeIcon filename={fileName} size={20} type={'file'} variant={'raw'} />
      <Flexbox horizontal gap={12} justify={'space-between'} style={{ maxWidth: 200 }}>
        <Text ellipsis>{fileName}</Text>
        {relevanceScore !== undefined && (
          <Tooltip title={`Relevance: ${(relevanceScore * 100).toFixed(1)}%`}>
            <Center className={styles.badge}>{relevanceScore.toFixed(2)}</Center>
          </Tooltip>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default FileItem;
