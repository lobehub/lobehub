'use client';

import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { type BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, Block, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';

import { type RunCommandState } from '../../type';

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

interface RunCommandParams {
  background?: boolean;
  command: string;
  timeout?: number;
}

const RunCommand = memo<BuiltinRenderProps<RunCommandParams, RunCommandState>>(
  ({ args, pluginState }) => {
    const isSuccess = pluginState?.success;
    const [expanded, setExpanded] = useState(false);

    const statusMessage = pluginState?.isBackground
      ? `Background command started (ID: ${pluginState.commandId})`
      : pluginState?.success
        ? 'Command completed'
        : pluginState?.error || 'Command failed';

    return (
      <Flexbox className={styles.container} gap={8}>
        {/* Header: Command + Status */}
        <Flexbox align={'center'} className={styles.header} horizontal justify={'space-between'}>
          <Flexbox gap={8} horizontal>
            <Flexbox gap={4} horizontal>
              {pluginState === undefined ? null : isSuccess ? (
                <CheckCircleFilled
                  className={styles.statusIcon}
                  style={{ color: cssVar.colorSuccess }}
                />
              ) : (
                <CloseCircleFilled
                  className={styles.statusIcon}
                  style={{ color: cssVar.colorError }}
                />
              )}
              <Text className={styles.head} ellipsis style={{ maxWidth: 300 }}>
                {args.command}
              </Text>
            </Flexbox>
            <Text className={styles.head} type={'secondary'}>
              {statusMessage}
            </Text>
          </Flexbox>
          <Flexbox align={'center'} gap={8} horizontal>
            <ActionIcon
              className={`action-icon`}
              icon={expanded ? ChevronUp : ChevronDown}
              onClick={() => setExpanded(!expanded)}
              size={'small'}
              style={{ opacity: expanded ? 1 : undefined }}
              title={expanded ? 'Collapse' : 'Expand'}
            />
          </Flexbox>
        </Flexbox>

        {/* Command & Output */}
        {expanded && (
          <Block gap={8} padding={8} variant={'outlined'}>
            <Highlighter
              language={'sh'}
              showLanguage={false}
              style={{ paddingInline: 8 }}
              variant={'borderless'}
              wrap
            >
              {args.command}
            </Highlighter>
            {pluginState?.output && (
              <Highlighter language={'text'} showLanguage={false} variant={'filled'} wrap>
                {pluginState.output}
              </Highlighter>
            )}
            {pluginState?.stderr && (
              <Highlighter language={'text'} showLanguage={false} variant={'filled'} wrap>
                {pluginState.stderr}
              </Highlighter>
            )}
          </Block>
        )}
      </Flexbox>
    );
  },
);

RunCommand.displayName = 'RunCommand';

export default RunCommand;
