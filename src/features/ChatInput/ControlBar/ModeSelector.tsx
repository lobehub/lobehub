import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { SkeletonBar } from '@/components/Skeleton';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useEffectiveAgentMode } from '@/features/ChatInput/hooks/useEffectiveAgentMode';
import { useToggleAgentMode } from '@/features/ChatInput/hooks/useToggleAgentMode';
import { usePermission } from '@/hooks/usePermission';

const styles = stylex.create({
  activeOption: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
  },
  agentTooltip: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px' },
  agentTooltipCap: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  agentTooltipTitle: {
    marginBlockEnd: '2px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  button: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  option: {
    cursor: 'pointer',
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionDesc: { fontSize: '12px', lineHeight: 1.4, color: cssVar.colorTextDescription },
  optionDisabled: {
    cursor: 'not-allowed',
    opacity: 0.55,
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionDisabledActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': 'transparent' },
    backgroundImage: 'none',
  },
  optionIcon: {
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  optionTitle: { fontSize: '14px', fontWeight: 500, lineHeight: 1.4, color: cssVar.colorText },
  // The popup pads its option rows by 4px, so its corner must be one step larger
  // than the rows' radius (borderRadius 8 → borderRadiusLG 12 = 8 + 4) to wrap them
  // concentrically instead of looking tighter than them.
  popoverPopup: { borderRadius: cssVar.borderRadiusLG },
});

const AGENT_CAPS = [
  { icon: WrenchIcon, key: 'tools' },
  { icon: SearchIcon, key: 'web' },
  { icon: FolderIcon, key: 'files' },
  { icon: TerminalIcon, key: 'env' },
] as const;

const ModeSelector = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const toggleAgentMode = useToggleAgentMode();
  useBusinessAgentModeSync(agentId);
  const [open, setOpen] = useState(false);
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  // Agent/Chat mode is a caller runtime preference for ordinary Workspace
  // members; only members who cannot use the Agent are disabled.
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();
  const disabled = !canCreateContent || !canUseResource;
  const disabledReason = !canCreateContent
    ? reason
    : t(isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent');

  const { canSelectAgentMode, currentMode, isAgentModeUnavailable, isPreferenceLoading } =
    useEffectiveAgentMode(agentId);
  const CurrentIcon = currentMode === 'agent' ? InfinityIcon : MessageCircleIcon;

  const handleSelect = useCallback(
    async (mode: 'chat' | 'agent') => {
      if (disabled) return;
      if (mode === 'agent' && !canSelectAgentMode) return;

      setOpen(false);
      await toggleAgentMode(mode === 'agent');
    },
    [disabled, canSelectAgentMode, toggleAgentMode],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (disabled) return;

      setOpen(nextOpen);
    },
    [disabled],
  );

  const agentTooltip = (
    <div {...stylex.props(styles.agentTooltip)}>
      <div {...stylex.props(styles.agentTooltipTitle)}>{t('chatMode.agent')}</div>
      {AGENT_CAPS.map(({ key, icon }) => (
        <div {...stylex.props(styles.agentTooltipCap)} key={key}>
          <Icon icon={icon} size={12} />
          {t(`chatMode.agentCap.${key}`)}
        </div>
      ))}
    </div>
  );

  const chatTooltip = t('chatMode.chatDesc');
  const buttonTooltip = isAgentModeUnavailable
    ? t('chatMode.agentUnsupported')
    : currentMode === 'agent'
      ? agentTooltip
      : chatTooltip;
  const agentDesc = canSelectAgentMode ? t('chatMode.agentDesc') : t('chatMode.agentUnsupported');

  const popoverContent = (
    <Flexbox gap={4} style={{ maxWidth: 320, minWidth: 280 }}>
      <Flexbox
        horizontal
        align="center"
        gap={12}
        className={
          stylex.props(
            styles.option,
            currentMode === 'agent' && styles.activeOption,
            !canSelectAgentMode && styles.optionDisabled,
            currentMode === 'agent' && !canSelectAgentMode && styles.optionDisabledActive,
          ).className
        }
        onClick={() => handleSelect('agent')}
      >
        <Flexbox
          align="center"
          className={stylex.props(styles.optionIcon).className}
          height={32}
          justify="center"
          width={32}
        >
          <Icon icon={InfinityIcon} size={16} />
        </Flexbox>
        <Flexbox flex={1}>
          <div {...stylex.props(styles.optionTitle)}>{t('chatMode.agent')}</div>
          <div {...stylex.props(styles.optionDesc)}>{agentDesc}</div>
        </Flexbox>
      </Flexbox>

      <Flexbox
        horizontal
        align="center"
        className={
          stylex.props(styles.option, currentMode === 'chat' && styles.activeOption).className
        }
        gap={12}
        onClick={() => handleSelect('chat')}
      >
        <Flexbox
          align="center"
          className={stylex.props(styles.optionIcon).className}
          height={32}
          justify="center"
          width={32}
        >
          <Icon icon={MessageCircleIcon} size={16} />
        </Flexbox>
        <Flexbox flex={1}>
          <div {...stylex.props(styles.optionTitle)}>{t('chatMode.chat')}</div>
          <div {...stylex.props(styles.optionDesc)}>{t('chatMode.chatDesc')}</div>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );

  const button = (
    <div {...stylex.props(styles.button, disabled && styles.buttonDisabled)}>
      <Icon icon={CurrentIcon} size={14} />
      <span>{t(`chatMode.${currentMode}`)}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  // Hold the pill's footprint (~70x23 settled) instead of collapsing the left cluster.
  if (isPreferenceLoading) return <SkeletonBar height={22} radius={4} width={68} />;

  if (disabled)
    return (
      <Tooltip title={disabledReason}>
        <div>{button}</div>
      </Tooltip>
    );

  return (
    <Popover
      className={stylex.props(styles.popoverPopup).className}
      content={popoverContent}
      open={!disabled && open}
      placement="topLeft"
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

ModeSelector.displayName = 'ModeSelector';

export default ModeSelector;
