'use client';

import type { WriteLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinStreamingProps } from '@lobechat/types';
import { Highlighter, Markdown } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo } from 'react';

type WriteFileArgs = WriteLocalFileParams & {
  file_path?: string;
  filePath?: string;
};

export const WriteFileStreaming = memo<BuiltinStreamingProps<WriteFileArgs>>(({ args }) => {
  const content = args?.content;
  const filePath = args?.path || args?.filePath || args?.file_path;

  // Don't render if no content yet
  if (!content) return null;

  const ext = path
    .extname(filePath || '')
    .slice(1)
    .toLowerCase();

  // Use Markdown for .md files, Highlighter for others
  if (ext === 'md' || ext === 'mdx') {
    return (
      <Markdown animated style={{ overflow: 'auto' }} variant={'chat'}>
        {content}
      </Markdown>
    );
  }

  return (
    <Highlighter
      animated
      wrap
      language={ext || 'text'}
      showLanguage={false}
      style={{ padding: '4px 8px' }}
      variant={'outlined'}
    >
      {content}
    </Highlighter>
  );
});

WriteFileStreaming.displayName = 'WriteFileStreaming';
