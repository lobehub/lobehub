import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import path from 'path-browserify-esm';
import React from 'react';

import FileIcon from '@/components/FileIcon';
import { localFileService } from '@/services/electron/localFileService';

const styles = stylex.create({
  container: {
    cursor: 'pointer',
    paddingBlock: '2px',
    paddingInlineStart: '4px',
    paddingInlineEnd: '8px',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  title: {
    overflow: 'hidden',
    display: 'block',
    lineHeight: '20px',
    color: 'inherit',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
      className={stylex.props(styles.container).className}
      gap={4}
      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
      onClick={handleClick}
    >
      <FileIcon isDirectory fileName={base} size={size} variant={'raw'} />
      <Flexbox horizontal align={'baseline'} gap={4} style={{ overflow: 'hidden', width: '100%' }}>
        <div {...stylex.props(styles.title)}>{base}</div>
      </Flexbox>
    </Flexbox>
  );
};
