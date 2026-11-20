'use client';

import { ActionIcon } from '@lobehub/ui';
import { LayoutDashboardIcon, PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHeaderActionSize } from '@/styles/density';

const WorkingPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const { pathname } = useLocation();
  const headerActionSmallSize = useHeaderActionSize(true);
  const [
    showRightPanel,
    showWorkingOverview,
    toggleRightPanel,
    openWorkingSidebar,
    updateSystemStatus,
    isStatusInit,
  ] = useGlobalStore((s) => [
    systemStatusSelectors.showRightPanel(s),
    systemStatusSelectors.showWorkingOverview(s),
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
      <ActionIcon
        active={showWorkingOverview}
        aria-label={t('workingPanel.overview.title')}
        icon={LayoutDashboardIcon}
        size={headerActionSmallSize}
        title={t('workingPanel.overview.title')}
        onClick={() => {
          if (showWorkingOverview) {
            updateSystemStatus({ showWorkingOverview: false });
            return;
          }
          toggleRightPanel(false);
          updateSystemStatus({ showWorkingOverview: true });
        }}
      />
      {!showRightPanel && (
        <ActionIcon
          aria-label={t('workingPanel.title')}
          icon={PanelRightOpenIcon}
          size={headerActionSmallSize}
          title={t('workingPanel.title')}
          onClick={() => openWorkingSidebar()}
        />
      )}
    </>
  );
});

export default WorkingPanelToggle;
