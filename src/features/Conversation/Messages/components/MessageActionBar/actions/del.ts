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
    const deleteDBMessage = useConversationStore((s) => s.deleteDBMessage);

    // A heterogeneous (CC/Codex) turn renders as ONE assistantGroup bubble whose
    // `children` are every real step in the run. Deleting the group id removes
    // the ENTIRE run — including all the steps that succeeded before the tail
    // failed. When the failing step is still present, delete ONLY that step so
    // the user keeps the work already done and can retry from there. The errored
    // step's id is a real DB message (a child block), not a top-level bubble, so
    // it must go through `deleteDBMessage` — `deleteMessage`/`getDisplayMessageById`
    // only resolve top-level display messages and would no-op on a child id.
    const erroredBlockId =
      ctx.role === 'group' ? ctx.data?.children?.findLast((block) => block.error)?.id : undefined;

    return useMemo(
      () => ({
        danger: true,
        handleClick: () => {
          if (erroredBlockId) {
            void deleteDBMessage(erroredBlockId);
            return;
          }
          deleteMessage(ctx.id);
        },
        icon: Trash,
        key: 'del',
        label: t('delete'),
      }),
      [t, ctx.id, deleteMessage, deleteDBMessage, erroredBlockId],
    );
  },
});
