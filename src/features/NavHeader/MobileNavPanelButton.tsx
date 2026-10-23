'use client';

import { ActionIcon, cssVar, Drawer } from '@lobehub/ui';
import { PanelLeftOpen } from 'lucide-react';
import { memo, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { MobileNavDrawerContext } from '@/features/NavPanel/MobileDrawerContext';
import {
  getNavPanelRegistrySnapshot,
  subscribeNavPanelRegistry,
} from '@/features/NavPanel/registry';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';

const DRAWER_WIDTH = 300;

/**
 * Desktop pages publish their sidebar (section nav, lists, pickers) through
 * `NavPanelPortal`, and only the desktop shell reads it. On mobile the same
 * registered content opens in a left drawer, so a page keeps its sub-navigation
 * without a mobile copy of every sidebar. `home` is the desktop agent list,
 * which mobile already shows as its home page.
 */
const MobileNavPanelButton = memo(() => {
  const { t } = useTranslation('hotkey');
  const navKey = useActiveNavKey();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const getContent = () =>
    navKey === 'home' ? undefined : getNavPanelRegistrySnapshot().get(navKey)?.node;
  const content = useSyncExternalStore(subscribeNavPanelRegistry, getContent, getContent);

  // Sidebar items navigate; picking one should reveal the page it opened.
  useEffect(() => {
    setOpen(false);
  }, [pathname, search]);

  if (!content) return null;

  return (
    <>
      <ActionIcon
        aria-label={t('toggleLeftPanel.title')}
        icon={PanelLeftOpen}
        size={MOBILE_HEADER_ICON_SIZE}
        title={t('toggleLeftPanel.title')}
        onClick={() => setOpen(true)}
      />
      <Drawer
        noHeader
        closable={false}
        open={open}
        placement={'left'}
        styles={{ bodyContent: { padding: 0 } }}
        width={DRAWER_WIDTH}
        style={{
          background: cssVar.colorBgLayout,
          borderRight: `1px solid ${cssVar.colorSplit}`,
        }}
        onClose={close}
      >
        <MobileNavDrawerContext value={close}>{content}</MobileNavDrawerContext>
      </Drawer>
    </>
  );
});

MobileNavPanelButton.displayName = 'MobileNavPanelButton';

export default MobileNavPanelButton;
