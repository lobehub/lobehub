import type { WriteLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, PatchDiff, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';

import { LocalFile, LocalFolder } from '@/features/LocalFile';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  previewBox: css`
    overflow: hidden;
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
  `,
}));

const buildNewFilePatch = (filePath: string, content: string) => {
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  const bodyLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const lineCount = bodyLines.length;
  const header = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lineCount} @@\n`;
  const body = bodyLines.map((line) => `+${line}`).join('\n');
  return hasTrailingNewline
    ? `${header}${body}\n`
    : `${header}${body}\n\\ No newline at end of file\n`;
};

const WriteFile = memo<BuiltinRenderProps<WriteLocalFileParams>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const { base, dir } = path.parse(args.path);
  const ext = path.extname(args.path).slice(1).toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'mdx';

  // Code-type files render as a "new file" unified diff so the visual is
  // consistent with EditLocalFile's PatchDiff. Markdown keeps its rendered
  // preview because a rendered doc reads better than an all-green diff.
  if (!isMarkdown && args.content) {
    return (
      <PatchDiff
        fileName={base}
        language={ext || undefined}
        patch={buildNewFilePatch(args.path, args.content)}
        showHeader={false}
        variant={'borderless'}
        viewMode={'unified'}
      />
    );
  }

  return (
    <Flexbox className={styles.container} gap={12}>
      <Flexbox horizontal align={'center'}>
        <LocalFolder path={dir} />
        <Icon icon={ChevronRight} />
        <LocalFile name={base} path={args.path} />
      </Flexbox>

      {args.content && (
        <Flexbox className={styles.previewBox}>
          <Markdown style={{ maxHeight: 240, overflow: 'auto', padding: '0 8px' }} variant={'chat'}>
            {args.content}
          </Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default WriteFile;
