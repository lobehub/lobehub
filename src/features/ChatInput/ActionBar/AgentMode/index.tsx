import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  FolderIcon,
  InfinityIcon,
  MessageCircleIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessAgentModeSync } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useToggleAgentMode } from '@/features/ChatInput/hooks/useToggleAgentMode';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

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

    transition: all 0.2s;

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
    padding-block: 10px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillSecondary};
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

const AgentMode = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const toggleAgentMode = useToggleAgentMode();
  useBusinessAgentModeSync(agentId);
  const [open, setOpen] = useState(false);
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  const enableAgentMode = useAgentStore(agentByIdSelectors.getAgentEnableModeById(agentId));

  const currentMode = enableAgentMode ? 'agent' : 'chat';
  const CurrentIcon = enableAgentMode ? InfinityIcon : MessageCircleIcon;

  const handleSelect = useCallback(
    async (mode: 'chat' | 'agent') => {
      if (!canCreateContent) return;

      setOpen(false);
      await toggleAgentMode(mode === 'agent');
    },
    [canCreateContent, toggleAgentMode],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!canCreateContent) return;

      setOpen(nextOpen);
    },
    [canCreateContent],
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

  const popoverContent = (
    <Flexbox gap={4} style={{ maxWidth: 320, minWidth: 280 }}>
      <Flexbox
        horizontal
        align="center"
        className={cx(styles.option, currentMode === 'agent' && styles.activeOption)}
        gap={12}
        onClick={() => handleSelect('agent')}
      >
        <Flexbox
          align="center"
          className={styles.optionIcon}
          height={32}
          justify="center"
          width={32}
        >
          <Icon icon={InfinityIcon} size={16} />
        </Flexbox>
        <Flexbox flex={1}>
          <div className={styles.optionTitle}>{t('chatMode.agent')}</div>
          <div className={styles.optionDesc}>{t('chatMode.agentDesc')}</div>
        </Flexbox>
      </Flexbox>

      <Flexbox
        horizontal
        align="center"
        className={cx(styles.option, currentMode === 'chat' && styles.activeOption)}
        gap={12}
        onClick={() => handleSelect('chat')}
      >
        <Flexbox
          align="center"
          className={styles.optionIcon}
          height={32}
          justify="center"
          width={32}
        >
          <Icon icon={MessageCircleIcon} size={16} />
        </Flexbox>
        <Flexbox flex={1}>
          <div className={styles.optionTitle}>{t('chatMode.chat')}</div>
          <div className={styles.optionDesc}>{t('chatMode.chatDesc')}</div>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );

  const button = (
    <div className={cx(styles.button, !canCreateContent && styles.buttonDisabled)}>
      <Icon icon={CurrentIcon} size={14} />
      <span>{t(`chatMode.${currentMode}`)}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
        <div>{button}</div>
      </Tooltip>
    );

  return (
    <Popover
      className={styles.popoverPopup}
      content={popoverContent}
      open={canCreateContent && open}
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
      <div>
        {open ? (
          button
        ) : (
          <Tooltip title={enableAgentMode ? agentTooltip : chatTooltip}>{button}</Tooltip>
        )}
      </div>
    </Popover>
  );
});

AgentMode.displayName = 'AgentMode';

export default AgentMode;
