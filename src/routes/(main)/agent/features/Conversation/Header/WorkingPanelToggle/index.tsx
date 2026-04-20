'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const WorkingPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const { pathname } = useLocation();
  const [showRightPanel, toggleRightPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showRightPanel(s),
    s.toggleRightPanel,
  ]);

  // The popup window has no WorkingSidebar — hide the toggle to avoid a
  // button that does nothing visible.
  if (pathname.startsWith('/popup')) return null;

  if (showRightPanel) return null;

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
