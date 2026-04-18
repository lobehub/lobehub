import { copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../store';
import { type MessageActionItem } from '../../../types';

export interface HeteroMessageActions {
  copy: MessageActionItem;
  del: MessageActionItem;
}

interface UseHeteroMessageActionsParams {
  content: string;
  id: string;
}

export const useHeteroMessageActions = ({
  id,
  content,
}: UseHeteroMessageActionsParams): HeteroMessageActions => {
  const { t } = useTranslation('common');
  const { message } = App.useApp();

  const deleteMessage = useConversationStore((s) => s.deleteMessage);

  return useMemo<HeteroMessageActions>(
    () => ({
      copy: {
        handleClick: async () => {
          await copyToClipboard(content);
          message.success(t('copySuccess'));
        },
        icon: Copy,
        key: 'copy',
        label: t('copy'),
      },
      del: {
        danger: true,
        handleClick: () => deleteMessage(id),
        icon: Trash,
        key: 'del',
        label: t('delete'),
      },
    }),
    [t, id, content, deleteMessage, message],
  );
};
