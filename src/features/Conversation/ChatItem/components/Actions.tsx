import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useDensity } from '@/styles/density';
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
  const { compact } = useDensity();
  if (!isDev && onboardingAgentId && conversationAgentId === onboardingAgentId) return null;

  const isUser = placement === 'right';
  const alignSelf = isUser ? 'flex-end' : 'flex-start';

  if (compact) {
    // The hover toolbar floats over the row instead of reserving a line under it; a user
    // bubble is right-aligned, so its toolbar takes the row's start corner to keep the
    // bubble text clear.
    return (
      <>
        {actionAddon && (
          <Flexbox horizontal align={'center'} gap={4} style={{ alignSelf }}>
            {actionAddon}
          </Flexbox>
        )}
        {(leading || actions) && (
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            {...stylex.props(
              revealStyles.floatingToolbar,
              isUser ? revealStyles.floatingToolbarStart : revealStyles.floatingToolbarEnd,
              !!leading && revealStyles.floatingToolbarLeading,
            )}
          >
            {leading}
            {actions && (
              <Flexbox horizontal align={'center'} role="menubar">
                {actions}
              </Flexbox>
            )}
          </Flexbox>
        )}
      </>
    );
  }

  return (
    <Flexbox align={'center'} direction={'horizontal'} gap={4} style={{ alignSelf }}>
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
