import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { isDev } from '@/utils/env';

import { contextSelectors, useConversationStore } from '../../store';
import { revealStyles } from '../revealStyles';
import type { ChatItemProps } from '../type';

export interface ActionsProps {
  actionAddon?: ChatItemProps['actionAddon'];
  actions: ChatItemProps['actions'];
  leading?: ReactNode;
  placement?: ChatItemProps['placement'];
}

const Actions = memo<ActionsProps>(({ actionAddon, leading, placement, actions }) => {
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
      {leading}
      {!isUser && actionAddon}
      {actions && (
        <Flexbox horizontal align={'center'} role="menubar" {...stylex.props(revealStyles.menubar)}>
          {actions}
        </Flexbox>
      )}
      {isUser && actionAddon}
    </Flexbox>
  );
});

export default Actions;
