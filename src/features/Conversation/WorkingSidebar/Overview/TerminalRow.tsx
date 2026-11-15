import { SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTerminalEntry } from '@/features/ChatTerminal/useTerminalEntry';
import { useGlobalStore } from '@/store/global';

import { ChevronRight, OverviewRow } from './OverviewRow';

/** Opens the terminal panel for agents that don't keep it in the header. */
export const TerminalRow = memo(() => {
  const { t } = useTranslation('chat');
  const visible = useTerminalEntry('overview');
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);

  if (!visible) return null;

  return (
    <OverviewRow
      weak
      icon={SquareTerminalIcon}
      iconSize={15}
      trailing={<ChevronRight />}
      value={t('terminalPanel.title')}
      onClick={() => toggleTerminalPanel(true)}
    />
  );
});

TerminalRow.displayName = 'OverviewTerminalRow';
