import { type MenuProps } from '@lobehub/ui';
import { Button, Center, DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Check, ChevronDown, Hand, ListChecks, Zap } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { type ApprovalMode } from '@/store/user/slices/settings/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
  `,
  icon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  modeButton: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

const ModeItemLabel = memo<{ desc: string; icon: LucideIcon; title: string }>(
  ({ desc, icon, title }) => (
    <Flexbox horizontal align={'flex-start'} gap={12}>
      <Center className={styles.icon} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1} style={{ minWidth: 120 }}>
        <div className={styles.title}>{title}</div>
        <div className={styles.desc}>{desc}</div>
      </Flexbox>
    </Flexbox>
  ),
);

const ModeSelector = memo(() => {
  const { t } = useTranslation('chat');
  const [dropdownOpen, setDropdownOpen] = useState(false);
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
      await updateHumanIntervention({ approvalMode: mode });
    },
    [updateHumanIntervention],
  );

  const menuItems = useMemo<MenuProps['items']>(
    () => [
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
      className={styles.modeButton}
      color={'default'}
      icon={ChevronDown}
      iconPlacement="end"
      size="small"
      variant={'text'}
    >
      {modeLabels[approvalMode]}
    </Button>
  );

  return (
    <DropdownMenu
      items={menuItems}
      open={dropdownOpen}
      placement="bottomLeft"
      onOpenChange={setDropdownOpen}
    >
      <div>
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
