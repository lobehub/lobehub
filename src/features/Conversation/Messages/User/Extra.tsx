import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { messageStateSelectors, useConversationStore } from '../../store';
import ExtraContainer from '../components/Extras/ExtraContainer';
import Translate from '../components/Extras/Translate';
import TTS from '../components/Extras/TTS';

interface UserMessageExtraProps {
  content: string;
  extra: any;
  id: string;
}

export const UserMessageExtra = memo<UserMessageExtraProps>(({ extra, id, content }) => {
  const loading = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const isLogin = useUserStore(authSelectors.isLogin);

  const showTranslate = !!extra?.translate;
  const showTTS = !!extra?.tts;

  const showExtra = isLogin && (showTranslate || showTTS);

  if (!showExtra) return;

  return (
    <Flexbox gap={8} style={{ marginTop: 8 }}>
      {extra?.tts && (
        <ExtraContainer>
          <TTS content={content} id={id} loading={loading} {...extra?.tts} />
        </ExtraContainer>
      )}
      {extra?.translate && (
        <ExtraContainer>
          <Translate id={id} {...extra?.translate} loading={loading} />
        </ExtraContainer>
      )}
    </Flexbox>
  );
});
