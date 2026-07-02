'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SendMessageArgs } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 60%;
    margin-inline-start: 6px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

/**
 * Chip for the multi-agent `SendMessage` tool — labels the target agent so the
 * timeline reads "Send message → <recipient>" instead of the raw arg dump.
 */
export const SendMessageInspector = memo<BuiltinInspectorProps<SendMessageArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t('builtins.lobe-claude-code.sendMessage.title');
    const source = args ?? partialArgs;
    const recipient = (source?.to ?? source?.recipient)?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    if (isArgumentsStreaming && !recipient) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span>{recipient ? `${label} →` : label}</span>
        {recipient && <span className={styles.chip}>{recipient}</span>}
      </div>
    );
  },
);

SendMessageInspector.displayName = 'ClaudeCodeSendMessageInspector';
