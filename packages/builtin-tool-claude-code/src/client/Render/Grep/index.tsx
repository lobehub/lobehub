'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Search } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  pattern: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  scope: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
}));

interface GrepArgs {
  glob?: string;
  output_mode?: 'files_with_matches' | 'content' | 'count';
  path?: string;
  pattern?: string;
  type?: string;
}

const Grep = memo<BuiltinRenderProps<GrepArgs>>(({ args, content }) => {
  const pattern = args?.pattern || '';
  const scope = args?.path || '';
  const glob = args?.glob || args?.type;

  return (
    <ToolResultCard
      wrapHeader
      icon={Search}
      header={
        <>
          {pattern && (
            <Text strong className={styles.pattern}>
              {pattern}
            </Text>
          )}
          {glob && <Tag>{glob}</Tag>}
          {scope && (
            <Text ellipsis className={styles.scope}>
              {scope}
            </Text>
          )}
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

Grep.displayName = 'ClaudeCodeGrep';

export default Grep;
