'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { RunCommandState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
}));

interface RunCommandParams {
  background?: boolean;
  command: string;
  description?: string;
  timeout?: number;
}

const RunCommand = memo<BuiltinRenderProps<RunCommandParams, RunCommandState>>(
  ({ args, pluginState }) => {
    return (
      <Flexbox className={styles.container} gap={8}>
        <Block gap={8} padding={8} variant={'outlined'}>
          <Highlighter
            wrap
            language={'sh'}
            showLanguage={false}
            style={{ maxHeight: 200, overflow: 'auto', paddingInline: 8 }}
            variant={'borderless'}
          >
            {args.command}
          </Highlighter>
          {pluginState?.output && (
            <Highlighter
              wrap
              language={'text'}
              showLanguage={false}
              style={{ maxHeight: 200, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {pluginState.output}
            </Highlighter>
          )}
          {pluginState?.stderr && (
            <Highlighter wrap language={'text'} showLanguage={false} variant={'filled'}>
              {pluginState.stderr}
            </Highlighter>
          )}
        </Block>
      </Flexbox>
    );
  },
);

RunCommand.displayName = 'RunCommand';

export default RunCommand;
