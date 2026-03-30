'use client';

import { Avatar, Button, Flexbox, FluentEmoji, Markdown, Text } from '@lobehub/ui';
import { LogoThree } from '@lobehub/ui/brand';
import { cx } from 'antd-style';
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
import { useAgentMeta } from '@/features/Conversation/hooks/useAgentMeta';
import { isDev } from '@/utils/env';

import { staticStyle } from './staticStyle';

const assistantLikeRoles = new Set(['assistant', 'assistantGroup', 'supervisor']);

interface AgentOnboardingConversationProps {
  finishTargetUrl?: string;
  onboardingFinished?: boolean;
  readOnly?: boolean;
}

const chatInputLeftActions: ActionKeys[] = isDev ? ['model'] : [];

const greetingCenterStyle: CSSProperties = { flex: 1, minHeight: '100%' };
const agentTitleStyle: CSSProperties = { fontSize: 12, fontWeight: 500 };
const outerContainerStyle: CSSProperties = { minHeight: 0 };
const scrollContainerStyle: CSSProperties = {
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  position: 'relative',
};
const completionTitleStyle: CSSProperties = { fontSize: 18, fontWeight: 600 };
const greetingContainerVT: CSSProperties = { viewTransitionName: 'greeting-container' };

const AgentOnboardingConversation = memo<AgentOnboardingConversationProps>(
  ({ finishTargetUrl, onboardingFinished, readOnly }) => {
    const { t } = useTranslation('onboarding');
    const agentMeta = useAgentMeta();
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

    const itemContent = (index: number, id: string) => {
      const isLatestItem = displayMessages.length === index + 1;

      if (showGreeting && index === 0) {
        const message = displayMessages[0];
        return (
          <Flexbox align={'center'} justify={'center'} style={greetingCenterStyle}>
            <Flexbox align={'center'} className={staticStyle.greetingWrap} gap={24}>
              <LogoThree className={staticStyle.greetingLogo} size={64} />
              <Flexbox className={cx(staticStyle.greetingCard)} style={greetingContainerVT}>
                <Flexbox horizontal align={'flex-start'} gap={12}>
                  <Avatar
                    avatar={agentMeta.avatar}
                    background={agentMeta.backgroundColor}
                    className={cx(staticStyle.greetingAvatar, staticStyle.greetingAvatarAnimated)}
                    shape={'square'}
                    size={36}
                  />
                  <Flexbox gap={4}>
                    <Text
                      className={staticStyle.greetingTitleAnimated}
                      style={agentTitleStyle}
                      type={'secondary'}
                    >
                      {agentMeta.title}
                    </Text>
                    <Markdown
                      className={cx(staticStyle.greetingText, staticStyle.greetingTextAnimated)}
                      variant={'chat'}
                    >
                      {message.content}
                    </Markdown>
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        );
      }

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
      <Flexbox
        className={staticStyle.viewTransitionGreeting}
        flex={1}
        style={outerContainerStyle}
        width={'100%'}
      >
        <Flexbox flex={1} style={scrollContainerStyle} width={'100%'}>
          <ChatList itemContent={itemContent} />
        </Flexbox>

        {!readOnly && !onboardingFinished && (
          <Flexbox className={staticStyle.composerZone}>
            <ChatInput
              allowExpand={false}
              leftActions={chatInputLeftActions}
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
