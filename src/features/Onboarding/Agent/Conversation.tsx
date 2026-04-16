'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { ActionKeys } from '@/features/ChatInput';
import {
  ChatInput,
  ChatList,
  conversationSelectors,
  MessageItem,
  useConversationStore,
} from '@/features/Conversation';
import { isDev } from '@/utils/env';

import CompletionPanel from './CompletionPanel';
import Welcome from './Welcome';

const assistantLikeRoles = new Set(['assistant', 'assistantGroup', 'supervisor']);

interface AgentOnboardingConversationProps {
  finishTargetUrl?: string;
  onboardingFinished?: boolean;
  readOnly?: boolean;
}

const chatInputLeftActions: ActionKeys[] = isDev ? ['model'] : [];

const AgentOnboardingConversation = memo<AgentOnboardingConversationProps>(
  ({ finishTargetUrl, onboardingFinished, readOnly }) => {
    const displayMessages = useConversationStore(conversationSelectors.displayMessages);

    const isGreetingState = useMemo(() => {
      if (displayMessages.length !== 1) return false;
      const first = displayMessages[0];
      return assistantLikeRoles.has(first.role);
    }, [displayMessages]);

    const [showGreeting, setShowGreeting] = useState(isGreetingState);
    const prevGreetingRef = useRef(isGreetingState);

    useEffect(() => {
      if (prevGreetingRef.current && !isGreetingState) {
        if (document.startViewTransition) {
          document.startViewTransition(() => {
            // eslint-disable-next-line @eslint-react/dom/no-flush-sync
            flushSync(() => setShowGreeting(false));
          });
        } else {
          setShowGreeting(false);
        }
      }
      if (!prevGreetingRef.current && isGreetingState) {
        setShowGreeting(true);
      }
      prevGreetingRef.current = isGreetingState;
    }, [isGreetingState]);

    const shouldShowGreetingWelcome = showGreeting && !onboardingFinished;

    const greetingWelcome = useMemo(() => {
      if (!shouldShowGreetingWelcome) return undefined;

      const message = displayMessages[0];
      if (!message || typeof message.content !== 'string') return undefined;

      return <Welcome content={message.content} />;
    }, [displayMessages, shouldShowGreetingWelcome]);

    if (onboardingFinished) return <CompletionPanel finishTargetUrl={finishTargetUrl} />;

    const listWelcome = greetingWelcome;

    const itemContent = (index: number, id: string) => {
      const isLatestItem = displayMessages.length === index + 1;
      return (
        <MessageItem
          defaultWorkflowExpanded={false}
          id={id}
          index={index}
          isLatestItem={isLatestItem}
        />
      );
    };

    return (
      <Flexbox flex={1} height={'100%'}>
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <ChatList
            itemContent={itemContent}
            showWelcome={shouldShowGreetingWelcome}
            welcome={listWelcome}
          />
        </Flexbox>
        {!readOnly && !onboardingFinished && (
          <ChatInput
            allowExpand={false}
            leftActions={chatInputLeftActions}
            showRuntimeConfig={false}
          />
        )}
      </Flexbox>
    );
  },
);

AgentOnboardingConversation.displayName = 'AgentOnboardingConversation';

export default AgentOnboardingConversation;
