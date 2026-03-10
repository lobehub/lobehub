import type { WriteLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Icon, Markdown, Skeleton } from '@lobehub/ui';
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

const WriteFile = memo<BuiltinRenderProps<WriteLocalFileParams>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const { base, dir } = path.parse(args.path);
  const ext = path.extname(args.path).slice(1).toLowerCase();

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
    <Flexbox className={styles.container} gap={12}>
      <Flexbox horizontal align={'center'}>
        <LocalFolder path={dir} />
        <Icon icon={ChevronRight} />
        <LocalFile name={base} path={args.path} />
      </Flexbox>

      {args.content && <Flexbox className={styles.previewBox}>{renderContent()}</Flexbox>}
    </Flexbox>
  );
});

export default WriteFile;
