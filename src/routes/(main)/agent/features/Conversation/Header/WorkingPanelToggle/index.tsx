'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { LayoutDashboardIcon, PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const WorkingPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const { pathname } = useLocation();
  const [
    showRightPanel,
    showWorkingOverview,
    toggleRightPanel,
    openWorkingSidebar,
    updateSystemStatus,
    isStatusInit,
  ] = useGlobalStore((s) => [
    systemStatusSelectors.showRightPanel(s),
    s.status.showWorkingOverview ?? !s.status.showRightPanel,
    s.toggleRightPanel,
    s.openWorkingSidebar,
    s.updateSystemStatus,
    systemStatusSelectors.isStatusInit(s),
  ]);

  // The popup window has no WorkingSidebar — hide the toggle to avoid a
  // button that does nothing visible.
  if (pathname.startsWith('/popup')) return null;

  // Defer render until status hydrates — updateSystemStatus is a no-op while
  // !isStatusInit, so clicks here would otherwise be silently dropped.
  if (!isStatusInit) return null;

  return (
    <>
      {!showWorkingOverview && (
        <ActionIcon
          aria-label={t('workingPanel.overview.title')}
          icon={LayoutDashboardIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('workingPanel.overview.title')}
          onClick={() => {
            toggleRightPanel(false);
            updateSystemStatus({ showWorkingOverview: true });
          }}
        />
      )}
      {!showRightPanel && (
        <ActionIcon
          aria-label={t('workingPanel.title')}
          icon={PanelRightOpenIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('workingPanel.title')}
          onClick={() => openWorkingSidebar()}
        />
      )}
    </>
  );
});

export default WorkingPanelToggle;
