import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
// lobe-design-ignore LOBE-ANTD-IMPORT: @lobehub/ui 5.64.4 does not export its style APIs
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  FolderIcon,
  InfinityIcon,
  MessageCircleIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessAgentModeSync } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import {
  type ChatInputMode,
  useEffectiveAgentMode,
} from '@/features/ChatInput/hooks/useEffectiveAgentMode';
import { useToggleAgentMode } from '@/features/ChatInput/hooks/useToggleAgentMode';
import { usePermission } from '@/hooks/usePermission';

const styles = createStaticStyles(({ css }) => ({
  activeOption: css`
    background: ${cssVar.colorFillSecondary};
  `,
  agentTooltip: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
  `,
  agentTooltipCap: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  agentTooltipTitle: css`
    margin-block-end: 2px;
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};

    transition:
      color 0.2s,
      background-color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  buttonDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  option: css`
    cursor: pointer;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  optionDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;

    &:hover {
      background: transparent;
    }
  `,
  optionDesc: css`
    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
  `,
  optionIcon: css`
    flex-shrink: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  optionTitle: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  popoverPopup: css`
    /* The popup pads its option rows by 4px, so its corner must be one step larger
       than the rows' radius (borderRadius 8 → borderRadiusLG 12 = 8 + 4) to wrap them
       concentrically instead of looking tighter than them. &&& outranks the base
       popup style's border-radius. */
    &&& {
      border-radius: ${cssVar.borderRadiusLG};
    }
  `,
}));

const AGENT_CAPS = [
  { icon: WrenchIcon, key: 'tools' },
  { icon: SearchIcon, key: 'web' },
  { icon: FolderIcon, key: 'files' },
  { icon: TerminalIcon, key: 'env' },
] as const;

const MODE_COPY = {
  'agent': { description: 'chatMode.agentDesc', label: 'chatMode.agent' },
  'chat': { description: 'chatMode.chatDesc', label: 'chatMode.chat' },
  'on-demand': { description: 'chatMode.onDemandDesc', label: 'chatMode.onDemand' },
} as const satisfies Record<ChatInputMode, { description: string; label: string }>;

const AgentMode = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const toggleAgentMode = useToggleAgentMode();
  useBusinessAgentModeSync(agentId);
  const [open, setOpen] = useState(false);
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const { canUseResource, isAccessLoading, isGroupContext } = useChatInputResourceAccess();

  const {
    canSelectAgentMode,
    canSelectOnDemandMode,
    currentMode,
    isAgentModeUnavailable,
    isPreferenceLoading,
  } = useEffectiveAgentMode(agentId);
  const disabled = !canCreateContent || !canUseResource;
  const disabledReason = !canCreateContent
    ? reason
    : t(isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent');
  const MODE_ICONS: Record<ChatInputMode, typeof InfinityIcon> = {
    'agent': InfinityIcon,
    'chat': MessageCircleIcon,
    'on-demand': ZapIcon,
  };
  const CurrentIcon = MODE_ICONS[currentMode];

  const handleSelect = useCallback(
    async (mode: ChatInputMode) => {
      if (disabled) return;
      if (mode === 'agent' && !canSelectAgentMode) return;
      if (mode === 'on-demand' && !canSelectOnDemandMode) return;

      setOpen(false);
      await toggleAgentMode(mode);
    },
    [canSelectAgentMode, canSelectOnDemandMode, disabled, toggleAgentMode],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (disabled) return;

      setOpen(nextOpen);
    },
    [disabled],
  );

  const agentTooltip = (
    <div className={styles.agentTooltip}>
      <div className={styles.agentTooltipTitle}>{t('chatMode.agent')}</div>
      {AGENT_CAPS.map(({ key, icon }) => (
        <div className={styles.agentTooltipCap} key={key}>
          <Icon icon={icon} size={12} />
          {t(`chatMode.agentCap.${key}`)}
        </div>
      ))}
    </div>
  );

  const chatTooltip = t('chatMode.chatDesc');
  const buttonTooltip = isAgentModeUnavailable
    ? t('chatMode.agentUnsupported')
    : currentMode === 'on-demand'
      ? t('chatMode.onDemandDesc')
      : currentMode === 'agent'
        ? agentTooltip
        : chatTooltip;
  const MODE_OPTIONS: Array<{
    disabled?: boolean;
    icon: typeof InfinityIcon;
    key: ChatInputMode;
  }> = [
    { icon: InfinityIcon, key: 'agent' },
    { icon: MessageCircleIcon, key: 'chat' },
    { disabled: !canSelectOnDemandMode, icon: ZapIcon, key: 'on-demand' },
  ];

  const popoverContent = (
    <Flexbox gap={4} style={{ maxWidth: 320, minWidth: 280 }}>
      {MODE_OPTIONS.map(({ disabled: optionDisabled, icon: OptionIcon, key }) => (
        <Flexbox
          horizontal
          align="center"
          aria-disabled={optionDisabled || undefined}
          gap={12}
          key={key}
          className={cx(
            styles.option,
            currentMode === key && styles.activeOption,
            optionDisabled && styles.optionDisabled,
          )}
          onClick={() => handleSelect(key)}
        >
          <Flexbox
            align="center"
            className={styles.optionIcon}
            height={32}
            justify="center"
            width={32}
          >
            <Icon icon={OptionIcon} size={16} />
          </Flexbox>
          <Flexbox flex={1}>
            <div className={styles.optionTitle}>{t(MODE_COPY[key].label)}</div>
            <div className={styles.optionDesc}>
              {t(
                optionDisabled && !canSelectAgentMode
                  ? 'chatMode.agentUnsupported'
                  : MODE_COPY[key].description,
              )}
            </div>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );

  const button = (
    <div className={cx(styles.button, disabled && styles.buttonDisabled)}>
      <Icon icon={CurrentIcon} size={14} />
      <span>{t(MODE_COPY[currentMode].label)}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  if (isAccessLoading || isPreferenceLoading) return null;

  if (disabled)
    return (
      <Tooltip title={disabledReason}>
        <div>{button}</div>
      </Tooltip>
    );

  return (
    <Popover
      className={styles.popoverPopup}
      content={popoverContent}
      open={!disabled && open}
      placement="bottomLeft"
      trigger="click"
      styles={{
        // Match the inner viewport's corner to the enlarged popup radius so its
        // border corners don't poke through the rounded popup.
        content: {
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: cssVar.borderRadiusLG,
          padding: 4,
        },
      }}
      onOpenChange={handleOpenChange}
    >
      <div>{open ? button : <Tooltip title={buttonTooltip}>{button}</Tooltip>}</div>
    </Popover>
  );
});

AgentMode.displayName = 'AgentMode';

export default AgentMode;
