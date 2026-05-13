'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { Settings2Icon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const ParamsPanelToggle = memo(() => {
  const { t } = useTranslation('setting');
  const { pathname } = useLocation();
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const [showRightPanel, workingSidebarTab, setWorkingSidebarTab, toggleRightPanel] =
    useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.status.workingSidebarTab,
      s.setWorkingSidebarTab,
      s.toggleRightPanel,
    ]);

  const active = showRightPanel && workingSidebarTab === 'params';

  const handleClick = useCallback(() => {
    if (active) {
      toggleRightPanel(false);
      return;
    }

    setWorkingSidebarTab('params');
    toggleRightPanel(true);
  }, [active, setWorkingSidebarTab, toggleRightPanel]);

  if (!isDevMode || pathname.startsWith('/popup')) return null;

  return (
    <ActionIcon
      active={active}
      icon={Settings2Icon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('settingModel.params.panel.title')}
      tooltipProps={{
        placement: 'bottom',
      }}
      onClick={handleClick}
    />
  );
});

ParamsPanelToggle.displayName = 'ParamsPanelToggle';

export default ParamsPanelToggle;
