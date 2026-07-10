'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const WorkingPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const { pathname } = useLocation();
  const [showRightPanel, toggleRightPanel, isStatusInit] = useGlobalStore((s) => [
    systemStatusSelectors.showRightPanel(s),
    s.toggleRightPanel,
    systemStatusSelectors.isStatusInit(s),
  ]);

  // The popup window has no WorkingSidebar — hide the toggle to avoid a
  // button that does nothing visible.
  if (pathname.startsWith('/popup')) return null;

  // Defer render until status hydrates — updateSystemStatus is a no-op while
  // !isStatusInit, so clicks here would otherwise be silently dropped.
  if (!isStatusInit) return null;

  if (showRightPanel) return null;

  // Open the panel without touching the tab preference — the sidebar's own
  // resolveActiveTab will pick the right default (and honor the user's last
  // explicit click). Force-setting `review` here would overwrite a previously
  // picked Space/Files tab every time the panel is re-opened.
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
