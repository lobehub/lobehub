import { StepForward } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const continueGenerationAction = defineAction({
  key: 'continueGeneration',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const lastBlockId = useConversationStore(dataSelectors.findLastMessageId(ctx.id));
    const isContinuing = useConversationStore((s) =>
      lastBlockId ? messageStateSelectors.isMessageContinuing(lastBlockId)(s) : false,
    );
    const continueGenerationMessage = useConversationStore((s) => s.continueGenerationMessage);

    return useMemo(() => {
      if (ctx.role !== 'group') return null;
      return {
        disabled: isContinuing,
        handleClick: () => {
          if (!lastBlockId) return;
          continueGenerationMessage(ctx.id, lastBlockId);
        },
        icon: StepForward,
        key: 'continueGeneration',
        label: t('messageAction.continueGeneration'),
        spin: isContinuing || undefined,
      };
    }, [t, ctx.id, ctx.role, lastBlockId, isContinuing, continueGenerationMessage]);
  },
});
