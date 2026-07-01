import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';

import { TAG_MARGIN_INLINE_END } from '../constants';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tag: css`
    cursor: default;
    user-select: none;

    display: inline-flex;
    gap: 3px;
    align-items: center;

    max-width: 240px;
    margin-inline-end: ${TAG_MARGIN_INLINE_END}px;
    padding-inline: 1px;

    color: ${cssVar.colorTextSecondary};
    vertical-align: baseline;
  `,
}));

export interface LocalFileMentionViewProps {
  isDirectory?: boolean;
  name: string;
}

export const LocalFileMentionView = memo<LocalFileMentionViewProps>(({ name, isDirectory }) => {
  return (
    <span className={styles.tag} title={name}>
      <FileIcon fileName={name} isDirectory={isDirectory} size={16} variant={'raw'} />
      <span className={styles.label}>{name}</span>
    </span>
  );
});

LocalFileMentionView.displayName = 'LocalFileMentionView';
