'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const WorkingPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const enableAgentWorkingPanel = useUserStore(labPreferSelectors.enableAgentWorkingPanel);
  const [showRightPanel, toggleRightPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showRightPanel(s),
    s.toggleRightPanel,
  ]);

  if (!enableAgentWorkingPanel || showRightPanel) return null;

  return (
    <ActionIcon
      icon={PanelRightOpenIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('workingPanel.title')}
      onClick={() => toggleRightPanel(true)}
    />
  );
});

export default WorkingPanelToggle;
