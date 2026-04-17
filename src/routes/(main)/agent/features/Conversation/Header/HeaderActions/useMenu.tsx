'use client';

import { Icon } from '@lobehub/ui';
import { type DropdownItem } from '@lobehub/ui';
import { FilePenIcon, Maximize2, PanelRightOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation('chat');
  const { t: tPortal } = useTranslation('portal');

  const [wideScreen, toggleRightPanel, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleRightPanel,
    s.toggleWideScreen,
  ]);
  const enableAgentWorkingPanel = useUserStore(labPreferSelectors.enableAgentWorkingPanel);

  const toggleNotebook = useChatStore((s) => s.toggleNotebook);

  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      {
        icon: <Icon icon={FilePenIcon} />,
        key: 'notebook',
        label: tPortal('notebook.title'),
        onClick: () => toggleNotebook(),
      },
    ];

    if (enableAgentWorkingPanel) {
      items.push({
        icon: <Icon icon={PanelRightOpen} />,
        key: 'agent-workspace',
        label: t('workingPanel.title'),
        onClick: () => toggleRightPanel(),
      });
    }

    items.push({
      checked: wideScreen,
      icon: <Icon icon={Maximize2} />,
      key: 'full-width',
      label: t('viewMode.fullWidth'),
      onCheckedChange: toggleWideScreen,
      type: 'switch',
    });

    return items;
  }, [
    enableAgentWorkingPanel,
    t,
    tPortal,
    toggleNotebook,
    toggleRightPanel,
    toggleWideScreen,
    wideScreen,
  ]);

  return { menuItems };
};
