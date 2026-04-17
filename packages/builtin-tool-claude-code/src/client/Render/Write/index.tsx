'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Icon, Markdown, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FilePlus2 } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    padding-inline: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  path: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
  previewBox: css`
    overflow: hidden;
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
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
        <Markdown style={{ maxHeight: 240, overflow: 'auto', padding: '0 8px' }} variant={'chat'}>
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
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Icon icon={FilePlus2} size={'small'} />
        <Text strong>{fileName || 'Write'}</Text>
        {filePath && filePath !== fileName && (
          <Text ellipsis className={styles.path}>
            {filePath}
          </Text>
        )}
      </Flexbox>

      {args.content && <Flexbox className={styles.previewBox}>{renderContent()}</Flexbox>}
    </Flexbox>
  );
});

Write.displayName = 'ClaudeCodeWrite';

export default Write;
