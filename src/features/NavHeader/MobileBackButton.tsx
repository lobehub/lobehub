'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChevronLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useMobileBack } from './useMobileBack';

interface MobileBackButtonProps {
  /** Workspace-aware path used when the page was opened directly. */
  fallback?: string;
}

/**
 * The mobile shell has no left panel, so page headers that would show the
 * panel toggle show this instead — it is the only way off a full-screen page.
 */
const MobileBackButton = memo<MobileBackButtonProps>(({ fallback }) => {
  const { t } = useTranslation('common');
  const back = useMobileBack(fallback);

  return (
    <ActionIcon
      aria-label={t('back')}
      icon={ChevronLeft}
      size={MOBILE_HEADER_ICON_SIZE}
      title={t('back')}
      onClick={back}
    />
  );
});

MobileBackButton.displayName = 'MobileBackButton';

export default MobileBackButton;
