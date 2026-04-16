'use client';

import { Icon } from '@lobehub/ui';
import { type DropdownItem } from '@lobehub/ui';
import { FilePenIcon, Maximize2, PanelRightOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation('chat');
  const { t: tPortal } = useTranslation('portal');

  const [wideScreen, toggleRightPanel, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleRightPanel,
    s.toggleWideScreen,
  ]);

  const toggleNotebook = useChatStore((s) => s.toggleNotebook);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <Icon icon={FilePenIcon} />,
        key: 'notebook',
        label: tPortal('notebook.title'),
        onClick: () => toggleNotebook(),
      },
      {
        icon: <Icon icon={PanelRightOpen} />,
        key: 'agent-workspace',
        label: t('workingPanel.title'),
        onClick: () => toggleRightPanel(),
      },
      {
        checked: wideScreen,
        icon: <Icon icon={Maximize2} />,
        key: 'full-width',
        label: t('viewMode.fullWidth'),
        onCheckedChange: toggleWideScreen,
        type: 'switch',
      },
    ],
    [t, tPortal, wideScreen, toggleRightPanel, toggleWideScreen, toggleNotebook],
  );

  return { menuItems };
};
