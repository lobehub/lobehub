import { ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

/**
 * Enters multi-select mode with the current message pre-checked, so the user can
 * keep checking more messages and forward the batch to another agent.
 */
export const selectAction = defineAction({
  key: 'select',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const enterSelectionMode = useConversationStore((s) => s.enterSelectionMode);

    return useMemo(
      () => ({
        handleClick: () => {
          enterSelectionMode(ctx.id);
        },
        icon: ListChecks,
        key: 'select',
        label: t('messageAction.select'),
      }),
      [t, ctx.id, enterSelectionMode],
    );
  },
});
