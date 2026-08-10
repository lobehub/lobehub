'use client';

import { ActionIcon } from '@lobehub/ui';
import { SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { useGlobalStore } from '@/store/global';

const TerminalPanelToggle = memo(() => {
  const { t } = useTranslation('chat');
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);

  if (!isDesktop) return null;

  return (
    <ActionIcon
      icon={SquareTerminalIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('terminalPanel.title')}
      tooltipProps={{ placement: 'bottom' }}
      onClick={() => toggleTerminalPanel(true)}
    />
  );
});

export default TerminalPanelToggle;
