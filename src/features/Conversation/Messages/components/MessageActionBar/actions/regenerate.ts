import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const regenerateAction = defineAction({
  key: 'regenerate',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const isRegenerating = useConversationStore(
      messageStateSelectors.isMessageRegenerating(ctx.id),
    );
    const [
      regenerateUserMessage,
      regenerateAssistantMessage,
      delAndRegenerateMessage,
      deleteMessage,
    ] = useConversationStore((s) => [
      s.regenerateUserMessage,
      s.regenerateAssistantMessage,
      s.delAndRegenerateMessage,
      s.deleteMessage,
    ]);

    return useMemo(
      () => ({
        disabled: isRegenerating,
        handleClick: () => {
          if (ctx.role === 'user') {
            void regenerateUserMessage(ctx.id);
            if (ctx.data.error) void deleteMessage(ctx.id);
            return;
          }

          // Retrying a FAILED assistant turn has to replace it, and
          // `delAndRegenerateMessage` is the only ordering that works: it deletes
          // first, then regenerates. Firing regenerate and delete concurrently
          // (what this did before) is broken twice over — the unawaited
          // regenerate computes its new branch index from the pre-delete child
          // count, so the index lands out of range once the delete resolves; and
          // the delete itself silently misses, because regenerate has already
          // switched the branch away from the very message it is trying to
          // remove. `delAndRegenerateMessage` carries that same reasoning in its
          // own body comment.
          if (ctx.data.error) void delAndRegenerateMessage(ctx.id);
          else void regenerateAssistantMessage(ctx.id);
        },
        icon: RotateCcw,
        key: 'regenerate',
        label: t('regenerate'),
        spin: isRegenerating || undefined,
      }),
      [
        t,
        ctx.id,
        ctx.role,
        ctx.data.error,
        isRegenerating,
        regenerateUserMessage,
        regenerateAssistantMessage,
        delAndRegenerateMessage,
        deleteMessage,
      ],
    );
  },
});
