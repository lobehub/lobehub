import { type MenuProps } from '@lobehub/ui';
import { Button, Center, DropdownMenu, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Check, ChevronDown, Hand, ListChecks, Zap } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { type ApprovalMode } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  modeButton: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  modeDesc: css`
    margin-block-start: 2px;
    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
  `,
  modeItem: css`
    min-width: 160px;
  `,
  modeLabel: css`
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

const ModeSelector = memo(() => {
  const { t } = useTranslation('chat');
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
        icon: (
          <Center className={styles.icon} height={32} width={32}>
            <Icon icon={Zap} />
          </Center>
        ),
        key: 'auto-run',
        label: (
          <div className={styles.modeItem}>
            <div className={styles.modeLabel}>{modeLabels['auto-run']}</div>
            <div className={styles.modeDesc}>{t('tool.intervention.mode.autoRunDesc')}</div>
          </div>
        ),
        onClick: () => handleModeChange('auto-run'),
      },
      {
        extra: approvalMode === 'allow-list' ? <Icon icon={Check} /> : undefined,
        icon: (
          <Center className={styles.icon} height={32} width={32}>
            <Icon icon={ListChecks} />
          </Center>
        ),
        key: 'allow-list',
        label: (
          <div className={styles.modeItem}>
            <div className={styles.modeLabel}>{modeLabels['allow-list']}</div>
            <div className={styles.modeDesc}>{t('tool.intervention.mode.allowListDesc')}</div>
          </div>
        ),
        onClick: () => handleModeChange('allow-list'),
      },
      {
        extra: approvalMode === 'manual' ? <Icon icon={Check} /> : undefined,
        icon: (
          <Center className={styles.icon} height={32} width={32}>
            <Icon icon={Hand} />
          </Center>
        ),
        key: 'manual',
        label: (
          <div className={styles.modeItem}>
            <div className={styles.modeLabel}>{modeLabels.manual}</div>
            <div className={styles.modeDesc}>{t('tool.intervention.mode.manualDesc')}</div>
          </div>
        ),
        onClick: () => handleModeChange('manual'),
      },
    ],
    [approvalMode, modeLabels, handleModeChange, styles, t],
  );

  return (
    <DropdownMenu items={menuItems} placement="bottomLeft">
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
    </DropdownMenu>
  );
});

export default ModeSelector;
