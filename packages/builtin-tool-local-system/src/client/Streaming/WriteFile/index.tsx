'use client';

import type { WriteLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinStreamingProps } from '@lobechat/types';
import { Highlighter, Markdown } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo } from 'react';

export const WriteFileStreaming = memo<BuiltinStreamingProps<WriteLocalFileParams>>(({ args }) => {
  const { content, path: filePath } = args || {};

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
