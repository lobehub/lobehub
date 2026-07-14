'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE, isDesktop } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const TerminalToggle = memo(() => {
  const { t } = useTranslation('chat');
  const enableBuiltinTerminal = useUserStore(labPreferSelectors.enableBuiltinTerminal);
  const [toggleTerminalPanel, isStatusInit] = useGlobalStore((s) => [
    s.toggleTerminalPanel,
    systemStatusSelectors.isStatusInit(s),
  ]);

  if (!isDesktop || !enableBuiltinTerminal) return null;

  // Defer render until status hydrates — updateSystemStatus is a no-op while
  // !isStatusInit, so clicks here would otherwise be silently dropped.
  if (!isStatusInit) return null;

  return (
    <ActionIcon
      icon={SquareTerminalIcon}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={t('terminalPanel.title')}
      onClick={() => toggleTerminalPanel()}
    />
  );
});

export default TerminalToggle;
