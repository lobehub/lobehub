'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { useEffect } from 'react';

import { useResolvedTabs } from '@/features/Electron/titlebar/TabBar/hooks/useResolvedTabs';

export const useDesktopDocumentTitle = (): void => {
  const { activeTabId, tabs } = useResolvedTabs();
  const title = tabs.find((tab) => tab.tab.id === activeTabId)?.meta.title;

  useEffect(() => {
    // `useResolvedTabs` falls back to the brand name for untitled routes —
    // suffixing it would render "LobeHub · LobeHub" where web shows the bare name.
    const meaningful = title && title !== BRANDING_NAME;
    document.title = meaningful ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME;
  }, [title]);
};
