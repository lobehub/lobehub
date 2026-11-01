import { type DropdownItem } from '@lobehub/ui';
import { Button, Center, DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, ChevronDown, Hand, ListChecks, Zap } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { type ApprovalMode } from '@/store/user/slices/settings/selectors';

const styles = stylex.create({
  desc: { fontSize: '12px', lineHeight: 1.4, color: cssVar.colorTextDescription },
  icon: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  modeButton: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextSecondary },
  modeButtonDisabled: { cursor: 'not-allowed', opacity: 0.5 },
  title: { fontSize: '14px', fontWeight: 500, lineHeight: 1.4, color: cssVar.colorText },
  trigger: { overflow: 'hidden', borderRadius: cssVar.borderRadius },
});

const ModeItemLabel = memo<{ desc: string; icon: LucideIcon; title: string }>(
  ({ desc, icon, title }) => (
    <Flexbox horizontal align={'flex-start'} gap={12}>
      <Center className={stylex.props(styles.icon).className} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1} style={{ minWidth: 120 }}>
        <div {...stylex.props(styles.title)}>{title}</div>
        <div {...stylex.props(styles.desc)}>{desc}</div>
      </Flexbox>
    </Flexbox>
  ),
);

const ModeSelector = memo(() => {
  const { t } = useTranslation('chat');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  // View-only General access: nothing can be sent from this input, so the
  // approval-mode picker is inert too (disabled, not hidden).
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();
  const disabled = !canCreateContent || !canUseResource;
  const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
  const updateHumanIntervention = useUserStore((s) => s.updateHumanIntervention);

  const modeLabels = useMemo(
    () => ({
      'allow-list': t('tool.intervention.mode.allowList'),
      'auto-run': t('tool.intervention.mode.autoRun'),
      'manual': t('tool.intervention.mode.manual'),
    }),
    [t],
  );

  const handleModeChange = useCallback(
    async (mode: ApprovalMode) => {
      if (disabled) return;

      await updateHumanIntervention({ approvalMode: mode });
    },
    [disabled, updateHumanIntervention],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (disabled) return;

      setDropdownOpen(nextOpen);
    },
    [disabled],
  );

  const menuItems = useCallback(
    (): DropdownItem[] => [
      {
        extra: approvalMode === 'auto-run' ? <Icon icon={Check} /> : undefined,
        key: 'auto-run',
        label: (
          <ModeItemLabel
            desc={t('tool.intervention.mode.autoRunDesc')}
            icon={Zap}
            title={modeLabels['auto-run']}
          />
        ),
        onClick: () => handleModeChange('auto-run'),
      },
      {
        extra: approvalMode === 'allow-list' ? <Icon icon={Check} /> : undefined,
        key: 'allow-list',
        label: (
          <ModeItemLabel
            desc={t('tool.intervention.mode.allowListDesc')}
            icon={ListChecks}
            title={modeLabels['allow-list']}
          />
        ),
        onClick: () => handleModeChange('allow-list'),
      },
      {
        extra: approvalMode === 'manual' ? <Icon icon={Check} /> : undefined,
        key: 'manual',
        label: (
          <ModeItemLabel
            desc={t('tool.intervention.mode.manualDesc')}
            icon={Hand}
            title={modeLabels.manual}
          />
        ),
        onClick: () => handleModeChange('manual'),
      },
    ],
    [approvalMode, modeLabels, handleModeChange, t],
  );

  const button = (
    <Button
      className={stylex.props(styles.modeButton).className}
      disabled={disabled}
      icon={ChevronDown}
      iconPosition="end"
      size="small"
      type={'text'}
    >
      {modeLabels[approvalMode]}
    </Button>
  );

  if (disabled)
    return (
      <Tooltip
        title={
          !canCreateContent
            ? reason
            : t(isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent')
        }
      >
        <div {...stylex.props(styles.modeButtonDisabled)}>{button}</div>
      </Tooltip>
    );

  return (
    <DropdownMenu
      items={menuItems}
      open={!disabled && dropdownOpen}
      placement="bottomRight"
      onOpenChange={handleOpenChange}
    >
      <div {...stylex.props(styles.trigger)}>
        {dropdownOpen ? (
          button
        ) : (
          <Tooltip title={t('tool.intervention.approvalMode')}>{button}</Tooltip>
        )}
      </div>
    </DropdownMenu>
  );
});

export default ModeSelector;
