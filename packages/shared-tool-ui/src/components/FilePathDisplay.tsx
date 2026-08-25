'use client';

import { Icon, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ImageIcon } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

const IMAGE_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
]);

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 4px;
  `,
  text: css`
    padding-block: 1px;
    color: ${cssVar.colorText};
  `,
}));

interface FilePathDisplayProps {
  filePath: string;
  isDirectory?: boolean;
}

export const getFilePathDisplayInfo = (filePath: string) => {
  if (!filePath) return { displayPath: '', isImage: false, name: '' };

  const { base, dir, ext } = path.parse(filePath);
  const parentDir = path.basename(dir);

  return {
    displayPath: parentDir ? `${parentDir}/${base}` : base,
    isImage: IMAGE_EXTENSIONS.has(ext.toLowerCase()),
    name: base,
  };
};

export const FilePathDisplay = memo<FilePathDisplayProps>(({ filePath, isDirectory }) => {
  const { displayPath, isImage, name } = useMemo(
    () => getFilePathDisplayInfo(filePath),
    [filePath],
  );

  if (!filePath) return null;

  return (
    <>
      {name &&
        (isImage && !isDirectory ? (
          <Icon className={styles.icon} icon={ImageIcon} size={16} />
        ) : (
          <MaterialFileTypeIcon
            className={styles.icon}
            fallbackUnknownType={false}
            filename={name}
            size={16}
            type={isDirectory ? 'folder' : 'file'}
            variant={'raw'}
          />
        ))}
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
