'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { ExecScriptParams, ExecScriptState } from '../../../types';

const styles = stylex.create({
  container: { overflow: 'hidden', paddingInlineStart: '8px', paddingInlineEnd: '0' },
});

const ExecScript = memo<BuiltinRenderProps<ExecScriptParams, ExecScriptState>>(
  ({ args, content, pluginState }) => {
    const { command } = pluginState || {};

    return (
      <Flexbox className={stylex.props(styles.container).className} gap={8}>
        <Block gap={8} padding={8} variant={'outlined'}>
          <Highlighter
            wrap
            language={'sh'}
            showLanguage={false}
            style={{ paddingInline: 8 }}
            variant={'borderless'}
          >
            {args?.command || command || ''}
          </Highlighter>
          {content && (
            <Highlighter wrap language={'text'} showLanguage={false} variant={'filled'}>
              {content}
            </Highlighter>
          )}
        </Block>
      </Flexbox>
    );
  },
);

export default ExecScript;
