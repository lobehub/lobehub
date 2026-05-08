'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter, Markdown, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FilePlus2 } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  path: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
}));

interface WriteArgs {
  content?: string;
  file_path?: string;
}

const Write = memo<BuiltinRenderProps<WriteArgs>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const filePath = args.file_path || '';
  const fileName = filePath ? path.basename(filePath) : '';
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

  return (
    <ToolResultCard
      icon={FilePlus2}
      header={
        <>
          <Text strong>{fileName || 'Write'}</Text>
          {filePath && filePath !== fileName && (
            <Text ellipsis className={styles.path}>
              {filePath}
            </Text>
          )}
        </>
      }
    >
      {renderContent()}
    </ToolResultCard>
  );
});

Write.displayName = 'ClaudeCodeWrite';

export default Write;
