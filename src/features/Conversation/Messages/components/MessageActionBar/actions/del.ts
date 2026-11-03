import { Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveHeteroErroredStepId } from '@/features/Conversation/Error/heterogeneous';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const delAction = defineAction({
  key: 'del',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const deleteMessage = useConversationStore((s) => s.deleteMessage);
    const deleteAssistantMessage = useConversationStore((s) => s.deleteAssistantMessage);

    // Deleting a heterogeneous (CC/Codex) run's group id removes the ENTIRE run,
    // including every step that succeeded before the tail failed. When only the
    // tail step died on a hetero status error, drop just that step.
    //
    // `deleteAssistantMessage` (not `deleteMessage`) resolves the child block
    // against `dbMessages` — `getDisplayMessageById` only sees top-level bubbles
    // and would no-op on a child id — and takes the step's tool result rows down
    // with it, which a bare single-id delete would leave orphaned.
    const erroredBlockId = resolveHeteroErroredStepId(ctx.data);

    return useMemo(
      () => ({
        danger: true,
        handleClick: () => {
          if (erroredBlockId) {
            void deleteAssistantMessage(erroredBlockId);
            return;
          }
          deleteMessage(ctx.id);
        },
        icon: Trash,
        key: 'del',
        label: t('delete'),
      }),
      [t, ctx.id, deleteMessage, deleteAssistantMessage, erroredBlockId],
    );
  },
});
