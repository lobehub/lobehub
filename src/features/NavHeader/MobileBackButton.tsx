'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChevronLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * react-router records the session-history index in `history.state.idx`; `0`
 * means this page was the entry point (deep link, refresh, new tab), so there is
 * no in-app page to go back to.
 */
export const canGoBackInApp = () => {
  if (typeof window === 'undefined') return false;
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
};

interface MobileBackButtonProps {
  /** Workspace-aware path used when the page was opened directly. */
  fallback?: string;
}

/**
 * The mobile shell has no left panel, so page headers that would show the
 * panel toggle show this instead — it is the only way off a full-screen page.
 */
const MobileBackButton = memo<MobileBackButtonProps>(({ fallback = '/' }) => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <ActionIcon
      aria-label={t('back')}
      icon={ChevronLeft}
      size={MOBILE_HEADER_ICON_SIZE}
      title={t('back')}
      onClick={() => {
        if (canGoBackInApp()) navigate(-1);
        else navigate(fallback);
      }}
    />
  );
});

MobileBackButton.displayName = 'MobileBackButton';

export default MobileBackButton;
