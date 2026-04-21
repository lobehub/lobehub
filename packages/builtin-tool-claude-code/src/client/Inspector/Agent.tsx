'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { Compass, type LucideIcon, Search, Settings } from 'lucide-react';
import { type ComponentType, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentArgs, ClaudeCodeApiName } from '../../types';

type IconComponent = LucideIcon | ComponentType<{ className?: string; size?: number }>;

/**
 * Known subagent templates shipped with CC. `subagent_type` on the tool call
 * is matched against this map; unknown values fall back to `GroupBotIcon` and
 * the raw type string, so user-defined subagents still render sensibly.
 */
const SUBAGENT_TYPES: Record<string, { icon: IconComponent; label: string }> = {
  'Explore': { icon: Search, label: 'Explore' },
  'Plan': { icon: Compass, label: 'Plan' },
  'general-purpose': { icon: GroupBotIcon, label: 'General purpose' },
  'statusline-setup': { icon: Settings, label: 'Statusline setup' },
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 60%;
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
    margin-inline-end: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  label: css`
    color: ${cssVar.colorText};
  `,
}));

/**
 * CC's subagent-spawn tool. `subagent_type` is the template ("Explore",
 * "general-purpose", ...) and becomes the primary label — saying "Agent"
 * is redundant once we're already rendering inside the Agent inspector.
 * `description` is the 3-5 word title the model writes ("Run pwd command")
 * and goes in the chip; the full `prompt` is too long for a collapsed header.
 */
export const AgentInspector = memo<BuiltinInspectorProps<AgentArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const fallbackLabel = t(ClaudeCodeApiName.Agent as any);

    const source = args ?? partialArgs;
    const description = source?.description?.trim();
    const subagentType = source?.subagent_type?.trim();

    const isShiny = isArgumentsStreaming || isLoading;

    const known = subagentType ? SUBAGENT_TYPES[subagentType] : undefined;
    const Icon = known?.icon ?? GroupBotIcon;
    const labelText = known?.label ?? subagentType ?? fallbackLabel;

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
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
