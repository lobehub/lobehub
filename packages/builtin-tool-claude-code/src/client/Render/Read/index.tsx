'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FileText } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  path: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
}));

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
  const fileName = filePath ? path.basename(filePath) : '';
  const ext = filePath ? path.extname(filePath).slice(1).toLowerCase() : '';

  const source = useMemo(() => stripLineNumbers(content || ''), [content]);

  return (
    <ToolResultCard
      icon={FileText}
      header={
        <>
          <Text strong>{fileName || 'Read'}</Text>
          {filePath && filePath !== fileName && (
            <Text ellipsis className={styles.path}>
              {filePath}
            </Text>
          )}
        </>
      }
    >
      {source && (
        <Highlighter
          wrap
          language={ext || 'text'}
          showLanguage={false}
          style={{ maxHeight: 240, overflow: 'auto' }}
          variant={'borderless'}
        >
          {source}
        </Highlighter>
      )}
    </ToolResultCard>
  );
});

Read.displayName = 'ClaudeCodeRead';

export default Read;
