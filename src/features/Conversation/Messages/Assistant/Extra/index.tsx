import { LOADING_FLAT } from '@lobechat/const';
import { type ModelPerformance, type ModelUsage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { messageStateSelectors, useConversationStore } from '../../../store';
import ExtraContainer from '../../components/Extras/ExtraContainer';
import Translate from '../../components/Extras/Translate';
import TTS from '../../components/Extras/TTS';
import Usage from '../../components/Extras/Usage';

interface AssistantMessageExtraProps {
  content: string;
  extra?: any;
  id: string;
  model?: string;
  performance?: ModelPerformance;
  provider?: string;
  tools?: any[];
  usage?: ModelUsage;
}

export const AssistantMessageExtra = memo<AssistantMessageExtraProps>(
  ({ extra, id, content, performance, usage, tools, provider, model }) => {
    const loading = useConversationStore(messageStateSelectors.isMessageGenerating(id));
    const isLogin = useUserStore(authSelectors.isLogin);

    return (
      <Flexbox gap={8} style={{ marginTop: !!tools?.length ? 8 : 4 }}>
        {content !== LOADING_FLAT && model && (
          <Usage model={model} performance={performance} provider={provider!} usage={usage} />
        )}
        {isLogin && (
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
        )}
      </Flexbox>
    );
  },
);
