'use client';

import { ActionIcon, cssVar, Drawer } from '@lobehub/ui';
import { MenuIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { MobileNavDrawerContext } from '@/features/NavPanel/MobileDrawerContext';

import { useNavPanelDrawerContent } from './useNavPanelDrawerContent';

const DRAWER_WIDTH = 300;

/**
 * Desktop pages publish their sidebar (section nav, lists, pickers) through
 * `NavPanelPortal`, and only the desktop shell reads it. On mobile the same
 * registered content opens in a left drawer, so a page keeps its sub-navigation
 * without a mobile copy of every sidebar.
 */
const MobileNavPanelButton = memo(() => {
  const { t } = useTranslation('common');
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const content = useNavPanelDrawerContent();

  // Sidebar items navigate; picking one should reveal the page it opened.
  useEffect(() => {
    setOpen(false);
  }, [pathname, search]);

  if (!content) return null;

  return (
    <>
      <ActionIcon
        aria-label={t('navPanel.openMenu')}
        icon={MenuIcon}
        size={MOBILE_HEADER_ICON_SIZE}
        title={t('navPanel.openMenu')}
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
