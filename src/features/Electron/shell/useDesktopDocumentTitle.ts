'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { useEffect } from 'react';

import { useResolvedTabs } from '@/features/Electron/titlebar/TabBar/hooks/useResolvedTabs';

export const useDesktopDocumentTitle = (): void => {
  const { activeTabId, tabs } = useResolvedTabs();
  const title = tabs.find((tab) => tab.tab.id === activeTabId)?.meta.title;

  useEffect(() => {
    document.title = title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME;
  }, [title]);
};
