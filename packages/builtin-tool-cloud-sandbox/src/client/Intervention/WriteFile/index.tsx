'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

interface WriteLocalFileParams {
  content: string;
  createDirectories?: boolean;
  path: string;
}

const WriteFile = memo<BuiltinInterventionProps<WriteLocalFileParams>>(({ args }) => {
  const { path, content } = args;
  const preview = content.length > 500 ? content.slice(0, 500) + '\n...(truncated)' : content;

  return (
    <Flexbox gap={8}>
      <Text>Write to file: {path}</Text>
      <Highlighter
        wrap
        language={'text'}
        showLanguage={false}
        style={{ maxHeight: 200, overflow: 'auto', padding: '4px 8px' }}
        variant={'outlined'}
      >
        {preview}
      </Highlighter>
    </Flexbox>
  );
});

export default WriteFile;
