import type { MessageMetadata } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { messageStateSelectors, useConversationStore } from '../../store';
import ExtraContainer from '../components/Extras/ExtraContainer';
import PageSelections from '../components/Extras/PageSelections';
import TTS from '../components/Extras/TTS';
import Translate from '../components/Extras/Translate';

interface UserMessageExtraProps {
  content: string;
  extra: any;
  id: string;
  metadata?: MessageMetadata | null;
}

export const UserMessageExtra = memo<UserMessageExtraProps>(({ extra, id, content, metadata }) => {
  const loading = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  const showTranslate = !!extra?.translate;
  const showTTS = !!extra?.tts;
  const showPageSelections = !!metadata?.pageSelections?.length;

  const showExtra = showTranslate || showTTS || showPageSelections;

  if (!showExtra) return;

  return (
    <Flexbox gap={8} style={{ marginTop: 8 }}>
      {showPageSelections && <PageSelections selections={metadata!.pageSelections!} />}
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
