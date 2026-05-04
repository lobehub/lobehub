import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { isDev } from '@/utils/env';

import { contextSelectors, useConversationStore } from '../../store';
import { type ChatItemProps } from '../type';

export interface ActionsProps {
  actions: ChatItemProps['actions'];
  placement?: ChatItemProps['placement'];
}

const Actions = memo<ActionsProps>(({ placement, actions }) => {
  const onboardingAgentId = useAgentStore(builtinAgentSelectors.webOnboardingAgentId);
  const conversationAgentId = useConversationStore(contextSelectors.agentId);
  if (!isDev && onboardingAgentId && conversationAgentId === onboardingAgentId) return null;

  const isUser = placement === 'right';
  return (
    <Flexbox
      align={'center'}
      direction={'horizontal'}
      gap={8}
      role="menubar"
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {actions}
    </Flexbox>
  );
});

export default Actions;
