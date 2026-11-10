'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { type DropdownItem, DropdownMenu, Icon, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  CloudIcon,
  LaptopIcon,
  type LucideIcon,
  MonitorIcon,
  MonitorOffIcon,
  SparklesIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { workingDirectoryChipStyles } from '@/features/ChatInput/ControlBar/workingDirectoryChipStyles';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';

const TARGET_ICONS: Record<DeviceExecutionTarget, LucideIcon> = {
  auto: SparklesIcon,
  device: MonitorIcon,
  local: LaptopIcon,
  none: MonitorOffIcon,
  sandbox: CloudIcon,
};

interface ProjectRunTargetChipProps {
  agentId: string;
  /** Icon only, the target in the tooltip — for a narrow composer. */
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Where the picked agent's new conversation runs, resolved the way the run
 * resolves it. The cloud sandbox is where a project's repository is checked
 * out, so an agent that runs anywhere else is offered the switch here; a device
 * pick stays with the conversation's own device picker.
 */
const ProjectRunTargetChip = ({ agentId, compact, disabled }: ProjectRunTargetChipProps) => {
  const { t } = useTranslation('project');
  const { t: tChat } = useTranslation('chat');
  const { agencyConfig, canDisplayExecutionTarget, canSelectExecutionTarget, workspaceScoped } =
    useEffectiveAgencyConfig(agentId, { topicId: null });
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const selectExecutionTarget = useSelectExecutionTarget(agentId);

  if (!canDisplayExecutionTarget) return null;

  const target = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero: !!agencyConfig?.heterogeneousProvider?.type,
    workspaceScoped,
  });
  const onSandbox = target === 'sandbox';
  const switchable = !onSandbox && canSelectExecutionTarget && !disabled;

  const switchToSandbox = async () => {
    if (!(await selectExecutionTarget('sandbox')))
      toast.error(t('overview.context.target.switchFailed'));
  };

  const label =
    target === 'device'
      ? t('overview.context.target.device')
      : tChat(`heteroAgent.executionTarget.${target}`);

  const chip = (
    <button
      aria-label={label}
      data-testid={'project-run-target-chip'}
      disabled={!switchable}
      type={'button'}
      {...stylex.props(
        workingDirectoryChipStyles.chip,
        styles.button,
        !switchable && styles.static,
        target === 'none' && styles.warning,
      )}
    >
      <Icon icon={TARGET_ICONS[target]} size={14} />
      {!compact && <span {...stylex.props(workingDirectoryChipStyles.label)}>{label}</span>}
      {switchable && <Icon icon={ChevronDownIcon} size={12} />}
    </button>
  );

  const hint = onSandbox
    ? t('overview.context.target.sandboxTooltip')
    : target === 'none'
      ? t('overview.context.target.noneTooltip')
      : undefined;
  const tooltip = compact ? [label, hint].filter(Boolean).join(' · ') : hint;

  if (!switchable)
    return (
      <Tooltip title={tooltip}>
        <div>{chip}</div>
      </Tooltip>
    );

  const items: DropdownItem[] = [
    {
      icon: <Icon icon={CloudIcon} />,
      key: 'sandbox',
      label: t('overview.context.target.useSandbox'),
      onClick: () => void switchToSandbox(),
    },
  ];

  return (
    <Tooltip title={tooltip}>
      <div>
        <DropdownMenu items={items} placement={'bottomRight'}>
          {chip}
        </DropdownMenu>
      </div>
    </Tooltip>
  );
};

const styles = stylex.create({
  // Body size and color: the tray says where the work happens, not a footnote.
  button: {
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
  },
  /** Shown, not picked: no hover, since nothing opens. */
  static: {
    cursor: 'default',
    backgroundColor: { 'default': 'transparent', ':hover': 'transparent' },
  },
  warning: {
    color: cssVar.colorWarning,
  },
});

export default ProjectRunTargetChip;
