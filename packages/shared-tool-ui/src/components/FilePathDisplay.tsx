'use client';

import { Icon, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  icon: { flexShrink: 0, marginInlineEnd: '4px' },
  text: { paddingBlock: '1px', color: cssVar.colorText },
});

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
          <Icon className={stylex.props(styles.icon).className} icon={ImageIcon} size={16} />
        ) : (
          <MaterialFileTypeIcon
            className={stylex.props(styles.icon).className}
            fallbackUnknownType={false}
            filename={name}
            size={16}
            type={isDirectory ? 'folder' : 'file'}
            variant={'raw'}
          />
        ))}
      {displayPath && (
        <Text
          className={stylex.props(styles.text).className}
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
