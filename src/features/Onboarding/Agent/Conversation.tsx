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
import { dataSelectors, messageStateSelectors } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { OnboardingPhase } from '@/types/user';
import { isDev } from '@/utils/env';

import CompletionPanel from './CompletionPanel';
import NameSuggestions from './NameSuggestions';
import Welcome from './Welcome';
import WrapUpHint from './WrapUpHint';

const assistantLikeRoles = new Set(['assistant', 'assistantGroup', 'supervisor']);

interface AgentOnboardingConversationProps {
  discoveryUserMessageCount?: number;
  feedbackSubmitted?: boolean;
  finishTargetUrl?: string;
  onAfterWrapUp?: () => Promise<unknown> | void;
  onAssistantTurnSettled?: (messageId: string) => Promise<unknown> | void;
  onboardingFinished?: boolean;
  phase?: OnboardingPhase;
  readOnly?: boolean;
  showFeedback?: boolean;
  topicId?: string;
}

const chatInputLeftActions: ActionKeys[] = isDev ? ['model'] : [];
const chatInputRightActions: ActionKeys[] = [];

const AgentOnboardingConversation = memo<AgentOnboardingConversationProps>(
  ({
    discoveryUserMessageCount,
    feedbackSubmitted,
    finishTargetUrl,
    onAfterWrapUp,
    onAssistantTurnSettled,
    onboardingFinished,
    phase,
    readOnly,
    showFeedback,
    topicId,
  }) => {
    const displayMessages = useConversationStore(conversationSelectors.displayMessages);
    const pendingInterventionCount = useConversationStore(
      (s) => dataSelectors.pendingInterventions(s).length,
    );

    const isGreetingState = useMemo(() => {
      if (displayMessages.length !== 1) return false;
      const first = displayMessages[0];
      return assistantLikeRoles.has(first.role);
    }, [displayMessages]);

    const latestAssistantMessageId = useMemo(() => {
      const latest = displayMessages.at(-1);
      if (!latest || !assistantLikeRoles.has(latest.role)) return undefined;

      return latest.id;
    }, [displayMessages]);

    const isLatestAssistantGenerating = useConversationStore((s) =>
      latestAssistantMessageId
        ? messageStateSelectors.isAssistantGroupItemGenerating(latestAssistantMessageId)(s)
        : false,
    );

    const [showGreeting, setShowGreeting] = useState(isGreetingState);
    const prevGreetingRef = useRef(isGreetingState);
    const armedSettledMessageIdRef = useRef<string>(undefined);
    const firedSettledMessageIdRef = useRef<string>(undefined);

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

    useEffect(() => {
      if (!onAssistantTurnSettled || !latestAssistantMessageId) return;

      if (pendingInterventionCount > 0) {
        armedSettledMessageIdRef.current = undefined;
        return;
      }

      if (isLatestAssistantGenerating) {
        armedSettledMessageIdRef.current = latestAssistantMessageId;
        return;
      }

      if (armedSettledMessageIdRef.current !== latestAssistantMessageId) return;
      if (firedSettledMessageIdRef.current === latestAssistantMessageId) return;

      firedSettledMessageIdRef.current = latestAssistantMessageId;
      armedSettledMessageIdRef.current = undefined;
      void onAssistantTurnSettled(latestAssistantMessageId);
    }, [
      isLatestAssistantGenerating,
      latestAssistantMessageId,
      onAssistantTurnSettled,
      pendingInterventionCount,
    ]);

    const shouldShowGreetingWelcome = showGreeting && !onboardingFinished;

    const greetingWelcome = useMemo(() => {
      if (!shouldShowGreetingWelcome) return undefined;

      const message = displayMessages[0];
      if (!message || typeof message.content !== 'string') return undefined;

      return <Welcome content={message.content} />;
    }, [displayMessages, shouldShowGreetingWelcome]);

    if (onboardingFinished)
      return (
        <CompletionPanel
          feedbackSubmitted={feedbackSubmitted}
          finishTargetUrl={finishTargetUrl}
          showFeedback={showFeedback}
          topicId={topicId}
        />
      );

    const listWelcome = greetingWelcome;

    const itemContent = (index: number, id: string) => {
      const isLatestItem = displayMessages.length === index + 1;

      return (
        <MessageItem
          defaultWorkflowExpandLevel="collapsed"
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
          <Flexbox gap={8}>
            <WrapUpHint
              discoveryUserMessageCount={discoveryUserMessageCount}
              phase={phase}
              onAfterFinish={onAfterWrapUp}
            />
            {shouldShowGreetingWelcome && (
              <WideScreenContainer>
                <NameSuggestions />
              </WideScreenContainer>
            )}
            <ChatInput
              disableFollowUpVariant
              disableMention
              disableQueue
              disableSlash
              allowExpand={false}
              leftActions={chatInputLeftActions}
              rightActions={chatInputRightActions}
              showRuntimeConfig={false}
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

AgentOnboardingConversation.displayName = 'AgentOnboardingConversation';

export default AgentOnboardingConversation;
