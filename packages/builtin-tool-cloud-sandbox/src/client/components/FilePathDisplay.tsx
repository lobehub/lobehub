'use client';

import { MaterialFileTypeIcon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 4px;
  `,
  text: css`
    color: ${cssVar.colorText};
  `,
}));

interface FilePathDisplayProps {
  filePath: string;
  isDirectory?: boolean;
}

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
          filename={name}
          size={16}
          type={isDirectory ? 'folder' : 'file'}
          variant={'raw'}
        />
      )}
      {displayPath && <span className={styles.text}>{displayPath}</span>}
    </>
  );
});

FilePathDisplay.displayName = 'FilePathDisplay';
