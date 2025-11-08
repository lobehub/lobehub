import { type MessageMetadata } from '@lobechat/types';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { LOADING_FLAT } from '@/const/message';
import ExtraContainer from '@/features/Conversation/components/Extras/ExtraContainer';
import TTS from '@/features/Conversation/components/Extras/TTS';
import Translate from '@/features/Conversation/components/Extras/Translate';
import Usage from '@/features/Conversation/components/Extras/Usage';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

interface AssistantMessageExtraProps {
  content: string;
  extra?: any;
  id: string;
  metadata?: MessageMetadata | null;
  tools?: any[];
}

export const AssistantMessageExtra = memo<AssistantMessageExtraProps>(
  ({ extra, id, content, metadata, tools }) => {
    const loading = useChatStore(chatSelectors.isMessageGenerating(id));

    return (
      <Flexbox gap={8} style={{ marginTop: !!tools?.length ? 8 : 4 }}>
        {content !== LOADING_FLAT && extra?.fromModel && (
          <Usage
            metadata={metadata || {}}
            model={extra?.fromModel}
            provider={extra.fromProvider!}
          />
        )}
        <>
          {!!extra?.tts && (
            <ExtraContainer>
              <TTS content={content} id={id} loading={loading} {...extra?.tts} />
            </ExtraContainer>
          )}
          {!!extra?.translate && (
            <ExtraContainer>
              <Translate id={id} loading={loading} {...extra?.translate} />
            </ExtraContainer>
          )}
        </>
      </Flexbox>
    );
  },
);
