'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import type { ReadKnowledgeArgs, ReadKnowledgeState } from '../../../types';
import FileCard from './FileCard';

const ReadKnowledge = memo<BuiltinRenderProps<ReadKnowledgeArgs, ReadKnowledgeState>>(
  ({ pluginState }) => {
    const { files } = pluginState || {};

    if (!files || files.length === 0) {
      return null;
    }

    return (
      <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
        {files.map((file) => (
          <FileCard file={file} key={file.fileId} />
        ))}
      </Flexbox>
    );
  },
);

export default ReadKnowledge;
