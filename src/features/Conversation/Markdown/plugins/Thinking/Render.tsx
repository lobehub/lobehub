import { memo } from 'react';

import Thinking from '@/features/Conversation/components/Thinking';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { dataSelectors, useConversationStore } from '../../../store';
import { type MarkdownElementProps } from '../type';

const isThinkingClosed = (input: string = '') => {
  const openTag = `<think>`;
  const closeTag = `</think>`;

  return input.includes(openTag) && input.includes(closeTag);
};

const Render = memo<MarkdownElementProps>(({ children, id }) => {
  const [isGenerating] = useConversationStore((s) => {
    const message = dataSelectors.getDbMessageById(id)(s);
    return [!isThinkingClosed(message?.content)];
  });
  const citations = useConversationStore((s) => {
    const message = dataSelectors.getDbMessageById(id)(s);
    return message?.search?.citations;
  });

  const transitionMode = useUserStore(userGeneralSettingsSelectors.transitionMode);

  if (!isGenerating && !children) return;

  return (
    <Thinking
      citations={citations}
      content={children as string}
      thinking={isGenerating}
      thinkingAnimated={transitionMode === 'fadeIn' && isGenerating}
    />
  );
});

export default Render;
