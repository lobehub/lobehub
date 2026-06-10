'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter, Markdown, Skeleton } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo } from 'react';

interface WriteArgs {
  content?: string;
  file_path?: string;
}

const Write = memo<BuiltinRenderProps<WriteArgs>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const filePath = args.file_path || '';
  const ext = filePath ? path.extname(filePath).slice(1).toLowerCase() : '';

  const renderContent = () => {
    if (!args.content) return null;

    if (ext === 'md' || ext === 'mdx') {
      return (
        <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
          {args.content}
        </Markdown>
      );
    }

    return (
      <Highlighter
        wrap
        language={ext || 'text'}
        showLanguage={false}
        style={{ maxHeight: 240, overflow: 'auto' }}
        variant={'borderless'}
      >
        {args.content}
      </Highlighter>
    );
  };

  return renderContent();
});

Write.displayName = 'ClaudeCodeWrite';

export default Write;
