import { Play } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const ttsAction = defineAction({
  key: 'tts',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const startMessageTTS = useConversationStore((s) => s.startMessageTTS);

    return useMemo(
      () => ({
        handleClick: () => startMessageTTS(ctx.id),
        icon: Play,
        key: 'tts',
        label: t('tts.action'),
      }),
      [t, ctx.id, startMessageTTS],
    );
  },
});
