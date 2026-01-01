'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { ComponentType, memo } from 'react';

import { ReadKnowledgeArgs, ReadKnowledgeState } from '../../../types';
import FileCard from './FileCard';

export interface ReadKnowledgeRenderProps extends Pick<
  BuiltinRenderProps<ReadKnowledgeArgs, ReadKnowledgeState>,
  'pluginState'
> {
  FileIcon: ComponentType<{ fileName: string; size: number }>;
  labels: {
    chars: string;
    lines: string;
  };
}

const ReadKnowledge = memo<ReadKnowledgeRenderProps>(({ pluginState, FileIcon, labels }) => {
  const { files } = pluginState || {};

  if (!files || files.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={12} horizontal style={{ flexWrap: 'wrap' }}>
      {files.map((file) => (
        <FileCard FileIcon={FileIcon} file={file} key={file.fileId} labels={labels} />
      ))}
    </Flexbox>
  );
});

export default ReadKnowledge;
