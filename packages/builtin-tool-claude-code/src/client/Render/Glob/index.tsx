'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FolderSearch } from 'lucide-react';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  count: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    padding-inline: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  pattern: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  previewBox: css`
    overflow: hidden;
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
  `,
  scope: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
}));

interface GlobArgs {
  path?: string;
  pattern?: string;
}

const Glob = memo<BuiltinRenderProps<GlobArgs>>(({ args, content }) => {
  const pattern = args?.pattern || '';
  const scope = args?.path || '';

  const matchCount = useMemo(() => {
    if (!content) return 0;
    return content.split('\n').filter((line: string) => line.trim().length > 0).length;
  }, [content]);

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8} wrap={'wrap'}>
        <Icon icon={FolderSearch} size={'small'} />
        {pattern && (
          <Text strong className={styles.pattern}>
            {pattern}
          </Text>
        )}
        {scope && (
          <Text ellipsis className={styles.scope}>
            {scope}
          </Text>
        )}
        {matchCount > 0 && <Text className={styles.count}>{`${matchCount} matches`}</Text>}
      </Flexbox>

      {content && (
        <Flexbox className={styles.previewBox}>
          <Highlighter
            wrap
            language={'text'}
            showLanguage={false}
            style={{ maxHeight: 240, overflow: 'auto' }}
            variant={'borderless'}
          >
            {content}
          </Highlighter>
        </Flexbox>
      )}
    </Flexbox>
  );
});

Glob.displayName = 'ClaudeCodeGlob';

export default Glob;
