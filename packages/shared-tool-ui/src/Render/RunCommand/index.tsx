'use client';

import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { getRunCommandDisplayCommand } from '../../utils/runCommand';
import AnsiOutput from './AnsiOutput';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
}));

interface RunCommandArgs {
  background?: boolean;
  command: string;
  description?: string;
  timeout?: number;
}

const RunCommand = memo<BuiltinRenderProps<RunCommandArgs, RunCommandState>>(
  ({ args, content, pluginState }) => {
    const output = pluginState?.stdout || pluginState?.output || content;
    const stderr = pluginState?.stderr;
    const command = getRunCommandDisplayCommand(args?.command);

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
            {command}
          </Highlighter>
          {output && <AnsiOutput text={output} />}
          {stderr?.trim() && <AnsiOutput text={stderr} />}
        </Block>
      </Flexbox>
    );
  },
);

RunCommand.displayName = 'RunCommand';

export default RunCommand;
