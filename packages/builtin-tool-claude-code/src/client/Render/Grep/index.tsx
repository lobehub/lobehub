'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Search } from 'lucide-react';
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
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8} wrap={'wrap'}>
        <Icon icon={Search} size={'small'} />
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

Grep.displayName = 'ClaudeCodeGrep';

export default Grep;
