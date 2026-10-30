import { copyToClipboard, Icon, toast } from '@lobehub/ui';
import { ClipboardCopyIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

/**
 * "Copy Agent ID" entry shared by the sidebar row menu and the Agent profile
 * header menu. Copying the id is read-only, so it carries no permission gate.
 * The label stays a plain string so the sidebar menu remains eligible for the
 * native desktop context menu.
 */
export const useCopyAgentIdMenuItem = (
  agentId: string | null | undefined,
): NativeContextMenuItem | null => {
  const { t } = useTranslation('chat');

  return useMemo(() => {
    if (!agentId) return null;

    return {
      icon: <Icon icon={ClipboardCopyIcon} />,
      key: 'copyAgentId',
      label: t('agent.copyId'),
      onClick: async (info?: { domEvent?: { stopPropagation: () => void } }) => {
        info?.domEvent?.stopPropagation();
        try {
          await copyToClipboard(agentId);
          toast.success(t('agent.copyIdSuccess'));
        } catch (error) {
          console.error('Failed to copy agent id:', error);
          toast.error(t('operationFailed', { ns: 'common' }));
        }
      },
      sfSymbol: 'doc.on.clipboard',
    };
  }, [agentId, t]);
};
