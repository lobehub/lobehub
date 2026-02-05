import { memo } from 'react';

import { ARTIFACT_THINKING_TAG } from '@/const/index';
import Thinking from '@/features/Conversation/components/Thinking';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { dataSelectors, useConversationStore } from '../../../store';
import type {MarkdownElementProps} from '../type';
import { isTagClosed } from '../utils';

const Render = memo<MarkdownElementProps>(({ children, id }) => {
  const [isGenerating] = useConversationStore((s) => {
    const message = dataSelectors.getDbMessageById(id)(s);
    return [!isTagClosed(ARTIFACT_THINKING_TAG, message?.content)];
  });
  const transitionMode = useUserStore(userGeneralSettingsSelectors.transitionMode);

  return (
    <Thinking
      content={children as string}
      style={{ width: isGenerating ? '100%' : undefined }}
      thinking={isGenerating}
      thinkingAnimated={transitionMode === 'fadeIn' && isGenerating}
    />
  );
});

export default Render;
