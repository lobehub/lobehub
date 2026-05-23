'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Globe } from 'lucide-react';
import { memo } from 'react';

import type { WebSearchArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  domains: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
  `,
  query: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
}));

const WebSearch = memo<BuiltinRenderProps<WebSearchArgs>>(({ args, content }) => {
  const query = args?.query || '';
  const allowed = args?.allowed_domains?.join(', ');
  const blocked = args?.blocked_domains?.map((d) => `-${d}`).join(', ');
  const scope = [allowed, blocked].filter(Boolean).join(' · ');

  return (
    <ToolResultCard
      wrapHeader
      icon={Globe}
      header={
        <>
          {query && (
            <Text strong className={styles.query}>
              {query}
            </Text>
          )}
          {scope && (
            <Text ellipsis className={styles.domains}>
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

WebSearch.displayName = 'ClaudeCodeWebSearch';

export default WebSearch;
