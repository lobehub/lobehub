'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type ExecuteCodeState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
}));

interface ExecuteCodeParams {
  code: string;
  language?: 'javascript' | 'python' | 'typescript';
}

const ExecuteCode = memo<BuiltinRenderProps<ExecuteCodeParams, ExecuteCodeState>>(
  ({ args, pluginState }) => {
    const language = args.language || 'python';

    return (
      <Flexbox className={styles.container} gap={8}>
        <Block gap={8} padding={8} variant={'outlined'}>
          <Highlighter
            language={language}
            showLanguage={false}
            style={{ maxHeight: 200, overflow: 'auto', paddingInline: 8 }}
            variant={'borderless'}
            wrap
          >
            {args.code}
          </Highlighter>
          {pluginState?.output && (
            <Highlighter
              language={'text'}
              showLanguage={false}
              style={{ maxHeight: 200, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
              wrap
            >
              {pluginState.output}
            </Highlighter>
          )}
          {pluginState?.stderr && (
            <Highlighter language={'text'} showLanguage={false} variant={'filled'} wrap>
              {pluginState.stderr}
            </Highlighter>
          )}
        </Block>
      </Flexbox>
    );
  },
);

ExecuteCode.displayName = 'ExecuteCode';

export default ExecuteCode;
