import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { isDev } from '@/utils/env';

import { contextSelectors, useConversationStore } from '../../store';
import type { ChatItemProps } from '../type';

export interface ActionsProps {
  actionAddon?: ChatItemProps['actionAddon'];
  actions: ChatItemProps['actions'];
  placement?: ChatItemProps['placement'];
}

const Actions = memo<ActionsProps>(({ actionAddon, placement, actions }) => {
  const onboardingAgentId = useAgentStore(builtinAgentSelectors.webOnboardingAgentId);
  const conversationAgentId = useConversationStore(contextSelectors.agentId);
  if (!isDev && onboardingAgentId && conversationAgentId === onboardingAgentId) return null;

  const isUser = placement === 'right';
  return (
    <Flexbox
      align={'center'}
      direction={'horizontal'}
      gap={4}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {!isUser && actionAddon}
      {actions && (
        <Flexbox horizontal align={'center'} role="menubar">
          {actions}
        </Flexbox>
      )}
      {isUser && actionAddon}
    </Flexbox>
  );
});

export default Actions;
