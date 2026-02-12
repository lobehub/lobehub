'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ExecScriptParams, ExecScriptState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
}));

const ExecScript = memo<BuiltinRenderProps<ExecScriptParams, ExecScriptState>>(
  ({ args, content, pluginState }) => {
    const { command } = pluginState || {};

    return (
      <Flexbox className={styles.container} gap={8}>
        <Block gap={8} padding={8} variant={'outlined'}>
          <Highlighter
            language={'sh'}
            showLanguage={false}
            style={{ paddingInline: 8 }}
            variant={'borderless'}
            wrap
          >
            {args?.command || command || ''}
          </Highlighter>
          {content && (
            <Highlighter language={'text'} showLanguage={false} variant={'filled'} wrap>
              {content}
            </Highlighter>
          )}
        </Block>
      </Flexbox>
    );
  },
);

export default ExecScript;
