import type { RunCommandParams, RunCommandResult } from '@lobechat/electron-client-ipc';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  head: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  header: css`
    .action-icon {
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    &:hover {
      .action-icon {
        opacity: 1;
      }
    }
  `,
  statusIcon: css`
    font-size: 12px;
  `,
}));

interface RunCommandState {
  message: string;
  result: RunCommandResult;
}

const RunCommand = memo<BuiltinRenderProps<RunCommandParams, RunCommandState>>(
  ({ args, pluginState }) => {
    const { result } = pluginState || {};

    return (
      <Flexbox className={styles.container} gap={8}>
        <Block gap={8} padding={8} variant={'outlined'}>
          <Highlighter
            wrap
            language={'sh'}
            showLanguage={false}
            style={{ paddingInline: 8 }}
            variant={'borderless'}
          >
            {args.command}
          </Highlighter>
          {result?.output && (
            <Highlighter wrap language={'text'} showLanguage={false} variant={'filled'}>
              {result.output}
            </Highlighter>
          )}
        </Block>
      </Flexbox>
    );
  },
);

export default RunCommand;
