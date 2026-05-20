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
    const [regenerateUserMessage, regenerateAssistantMessage, deleteMessage] = useConversationStore(
      (s) => [s.regenerateUserMessage, s.regenerateAssistantMessage, s.deleteMessage],
    );

    return useMemo(
      () => ({
        disabled: isRegenerating,
        handleClick: () => {
          if (ctx.role === 'user') {
            regenerateUserMessage(ctx.id);
            if (ctx.data.error) deleteMessage(ctx.id);
          } else {
            regenerateAssistantMessage(ctx.id);
            if (ctx.data.error) deleteMessage(ctx.id);
          }
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
        deleteMessage,
      ],
    );
  },
});
