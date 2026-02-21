'use client';

import { MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 4px;
  `,
  text: css`
    overflow: hidden;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface FilePathDisplayProps {
  filePath: string;
  isDirectory?: boolean;
}

/**
 * Reusable component for displaying file/folder icon + path in LocalSystem inspectors
 * Used by Read, Write, Edit, Delete, Rename, List inspectors
 */
export const FilePathDisplay = memo<FilePathDisplayProps>(({ filePath, isDirectory }) => {
  const { displayPath, name } = useMemo(() => {
    if (!filePath) return { displayPath: '', name: '' };
    const { base, dir } = path.parse(filePath);
    const parentDir = path.basename(dir);
    return {
      displayPath: parentDir ? `${parentDir}/${base}` : base,
      name: base,
    };
  }, [filePath]);

  if (!filePath) return null;

  return (
    <>
      {name && (
        <MaterialFileTypeIcon
          className={styles.icon}
          fallbackUnknownType={false}
          filename={name}
          size={16}
          type={isDirectory ? 'folder' : 'file'}
          variant={'raw'}
        />
      )}
      {displayPath && (
        <Text
          className={styles.text}
          ellipsis={{
            tooltipWhenOverflow: true,
          }}
        >
          {displayPath}
        </Text>
      )}
    </>
  );
});

FilePathDisplay.displayName = 'FilePathDisplay';
