'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

interface ReadArgs {
  file_path?: string;
  limit?: number;
  offset?: number;
}

/**
 * Strip Claude Code's numbered-line prefix (e.g. `␣␣␣␣␣1\tfoo`) so the
 * Highlighter can tokenize the actual source. CC always returns this `cat -n`
 * style output; we keep the line numbers conceptually via Highlighter's own
 * gutter when available, and otherwise just display the raw source.
 */
const stripLineNumbers = (text: string): string => {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n');
};

const Read = memo<BuiltinRenderProps<ReadArgs>>(({ args, content }) => {
  const filePath = args?.file_path || '';
  const ext = filePath ? path.extname(filePath).slice(1).toLowerCase() : '';

  const source = useMemo(() => stripLineNumbers(content || ''), [content]);
  if (!source) return null;

  return (
    <Highlighter
      wrap
      language={ext || 'text'}
      showLanguage={false}
      style={{ maxHeight: 240, overflow: 'auto' }}
      variant={'borderless'}
    >
      {source}
    </Highlighter>
  );
});

Read.displayName = 'ClaudeCodeRead';

export default Read;
