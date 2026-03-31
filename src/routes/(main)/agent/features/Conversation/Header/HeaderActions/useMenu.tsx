'use client';

import { Icon } from '@lobehub/ui';
import { type DropdownItem } from '@lobehub/ui';
import { FilePenIcon, Maximize2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation('chat');
  const { t: tPortal } = useTranslation('portal');

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  const [showNotebook, toggleNotebook] = useChatStore((s) => [s.showNotebook, s.toggleNotebook]);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <Icon icon={FilePenIcon} />,
        key: 'notebook',
        label: tPortal('notebook.title'),
        onClick: () => toggleNotebook(),
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
    [t, tPortal, wideScreen, toggleWideScreen, showNotebook, toggleNotebook],
  );

  return { menuItems };
};
