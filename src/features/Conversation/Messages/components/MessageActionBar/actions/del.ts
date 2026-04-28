import { Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const delAction = defineAction({
  key: 'del',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const deleteMessage = useConversationStore((s) => s.deleteMessage);

    return useMemo(
      () => ({
        danger: true,
        handleClick: () => deleteMessage(ctx.id),
        icon: Trash,
        key: 'del',
        label: t('delete'),
      }),
      [t, ctx.id, deleteMessage],
    );
  },
});
