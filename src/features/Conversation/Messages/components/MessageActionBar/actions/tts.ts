import { Play } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const ttsAction = defineAction({
  key: 'tts',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const ttsMessage = useConversationStore((s) => s.ttsMessage);

    return useMemo(
      () => ({
        handleClick: () => ttsMessage(ctx.id),
        icon: Play,
        key: 'tts',
        label: t('tts.action'),
      }),
      [t, ctx.id, ttsMessage],
    );
  },
});
