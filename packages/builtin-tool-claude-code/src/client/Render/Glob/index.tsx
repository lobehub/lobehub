'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';

interface GlobArgs {
  path?: string;
  pattern?: string;
}

const Glob = memo<BuiltinRenderProps<GlobArgs>>(({ content }) => {
  if (!content) return null;

  return (
    <Highlighter
      wrap
      language={'text'}
      showLanguage={false}
      style={{ maxHeight: 240, overflow: 'auto' }}
      variant={'borderless'}
    >
      {content}
    </Highlighter>
  );
});

Glob.displayName = 'ClaudeCodeGlob';

export default Glob;
