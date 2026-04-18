'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FolderSearch } from 'lucide-react';
import { memo, useMemo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  pattern: css`
    font-family: ${cssVar.fontFamilyCode};
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
    <ToolResultCard
      wrapHeader
      icon={FolderSearch}
      header={
        <>
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
        </>
      }
    >
      {content && (
        <Highlighter
          wrap
          language={'text'}
          showLanguage={false}
          style={{ maxHeight: 240, overflow: 'auto' }}
          variant={'borderless'}
        >
          {content}
        </Highlighter>
      )}
    </ToolResultCard>
  );
});

Glob.displayName = 'ClaudeCodeGlob';

export default Glob;
