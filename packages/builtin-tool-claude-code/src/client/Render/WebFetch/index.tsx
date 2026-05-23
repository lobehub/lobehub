'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Link } from 'lucide-react';
import { memo } from 'react';

import type { WebFetchArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  prompt: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
  url: css`
    font-family: ${cssVar.fontFamilyCode};
    word-break: break-all;
  `,
}));

const WebFetch = memo<BuiltinRenderProps<WebFetchArgs>>(({ args, content }) => {
  const url = args?.url || '';
  const prompt = args?.prompt || '';

  return (
    <ToolResultCard
      wrapHeader
      icon={Link}
      header={
        <>
          {url && (
            <Text ellipsis strong className={styles.url}>
              {url}
            </Text>
          )}
          {prompt && (
            <Text ellipsis className={styles.prompt}>
              {prompt}
            </Text>
          )}
        </>
      }
    >
      {content && (
        <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
          {content}
        </Markdown>
      )}
    </ToolResultCard>
  );
});

WebFetch.displayName = 'ClaudeCodeWebFetch';

export default WebFetch;
