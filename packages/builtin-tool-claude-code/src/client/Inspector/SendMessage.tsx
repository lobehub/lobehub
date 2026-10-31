'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SendMessageArgs } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
});

/**
 * Chip for the multi-agent `SendMessage` tool. Leads with the human-readable
 * `summary` (falling back to the message body) rather than the opaque agent id
 * from `to`/`recipient`, which means nothing to an end user.
 */
export const SendMessageInspector = memo<BuiltinInspectorProps<SendMessageArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t('builtins.lobe-claude-code.sendMessage.title');
    const source = args ?? partialArgs;
    const recap = (source?.summary ?? source?.message ?? source?.content)?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    if (isArgumentsStreaming && !recap) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(isShiny && shinyTextStyles.shinyText)}>
          {recap ? `${label}:` : label}
        </span>
        {recap && <span {...stylex.props(styles.chip)}>{recap}</span>}
      </div>
    );
  },
);

SendMessageInspector.displayName = 'ClaudeCodeSendMessageInspector';
