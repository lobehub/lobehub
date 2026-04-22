'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentArgs, ClaudeCodeApiName } from '../../types';
import { resolveCCSubagentType } from '../subagentTypes';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  chipText: css`
    overflow: hidden;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    flex-shrink: 0;
    margin-inline: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  label: css`
    flex-shrink: 0;
    color: ${cssVar.colorText};
  `,
}));

/**
 * CC's subagent-spawn tool. `subagent_type` ("Explore", "general-purpose", ...)
 * is the variant; we prefix it with "Agent:" so the row visibly reads as a
 * subagent dispatch rather than a regular tool — the icon alone isn't enough
 * signal. `description` is the 3-5 word title the model writes and goes in the
 * chip; the full `prompt` is too long for a collapsed header.
 */
export const AgentInspector = memo<BuiltinInspectorProps<AgentArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const fallbackLabel = t(ClaudeCodeApiName.Agent as any);

    const source = args ?? partialArgs;
    const description = source?.description?.trim();
    const subagentType = source?.subagent_type?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    const resolved = resolveCCSubagentType(subagentType);
    const Icon = resolved?.icon ?? GroupBotIcon;
    const labelText = resolved?.label ?? fallbackLabel;

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span className={styles.label}>Agent:</span>
        <Icon className={styles.icon} size={14} />
        <span className={styles.label}>{labelText}</span>
        {description && (
          <span className={styles.chip}>
            <span className={styles.chipText}>{description}</span>
          </span>
        )}
      </div>
    );
  },
);

AgentInspector.displayName = 'ClaudeCodeAgentInspector';
