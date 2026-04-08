'use client';

import { Button, Flexbox, FluentEmoji, Text } from '@lobehub/ui';
import { LogIn } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ActionKeys } from '@/features/ChatInput';
import {
  ChatInput,
  ChatList,
  conversationSelectors,
  MessageItem,
  useConversationStore,
} from '@/features/Conversation';
import { isDev } from '@/utils/env';

import { staticStyle } from './staticStyle';
import Welcome from './Welcome';

const assistantLikeRoles = new Set(['assistant', 'assistantGroup', 'supervisor']);

interface AgentOnboardingConversationProps {
  finishTargetUrl?: string;
  onboardingFinished?: boolean;
  readOnly?: boolean;
}

const chatInputLeftActions: ActionKeys[] = isDev ? ['model'] : [];
const completionTitleStyle: CSSProperties = { fontSize: 18, fontWeight: 600 };

const AgentOnboardingConversation = memo<AgentOnboardingConversationProps>(
  ({ finishTargetUrl, onboardingFinished, readOnly }) => {
    const { t } = useTranslation('onboarding');
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

    const greetingWelcome = useMemo(() => {
      if (!showGreeting) return undefined;

      const message = displayMessages[0];
      if (!message || typeof message.content !== 'string') return undefined;

      return <Welcome content={message.content} />;
    }, [displayMessages, showGreeting]);

    const itemContent = (index: number, id: string) => {
      const isLatestItem = displayMessages.length === index + 1;

      if (isLatestItem && onboardingFinished) {
        return (
          <>
            <MessageItem id={id} index={index} isLatestItem={isLatestItem} />
            <Flexbox
              align={'center'}
              className={staticStyle.completionEnter}
              gap={14}
              paddingBlock={40}
            >
              <FluentEmoji emoji={'🎉'} size={56} type={'anim'} />
              <Text style={completionTitleStyle}>{t('agent.completionTitle')}</Text>
              <Text type={'secondary'}>{t('agent.completionSubtitle')}</Text>
              <Button
                icon={<LogIn size={16} />}
                style={{ marginTop: 8 }}
                type={'primary'}
                onClick={() => {
                  if (finishTargetUrl) window.location.assign(finishTargetUrl);
                }}
              >
                {t('agent.enterApp')}
              </Button>
            </Flexbox>
          </>
        );
      }

      return <MessageItem id={id} index={index} isLatestItem={isLatestItem} />;
    };

    return (
      <Flexbox flex={1} height={'100%'}>
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <ChatList
            itemContent={itemContent}
            showWelcome={showGreeting}
            welcome={greetingWelcome}
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
