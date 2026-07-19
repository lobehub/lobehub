'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentMeta } from '@/features/Conversation/hooks/useAgentMeta';
import { useIsMobile } from '@/hooks/useIsMobile';
import LobeMessage from '@/routes/onboarding/components/LobeMessage';
import { consumeOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import FeedbackPanel from './FeedbackPanel';
import MessengerIntegrations from './MessengerIntegrations';
import { staticStyle } from './staticStyle';

interface CompletionPanelProps {
  feedbackSubmitted?: boolean;
  finishTargetUrl?: string;
  showFeedback?: boolean;
  topicId?: string;
}

const CompletionPanel = memo<CompletionPanelProps>(
  ({ feedbackSubmitted, finishTargetUrl, showFeedback, topicId }) => {
    const { t } = useTranslation('onboarding');
    const isMobile = useIsMobile();
    const agentMeta = useAgentMeta();
    return (
      <Center height={'100%'} paddingInline={isMobile ? 16 : 0} width={'100%'}>
        <Flexbox
          align={'center'}
          className={staticStyle.completionEnter}
          gap={isMobile ? 12 : 14}
          width={'100%'}
        >
          <Flexbox
            align={'center'}
            gap={isMobile ? 12 : 14}
            style={{ maxWidth: 600, width: '100%' }}
          >
            <LobeMessage
              align={'center'}
              avatar={agentMeta.avatar}
              avatarSize={isMobile ? 56 : 72}
              fontSize={isMobile ? 24 : 32}
              gap={isMobile ? 12 : 16}
              sentences={[
                t('agent.completion.sentence.readyWithName', { name: agentMeta.title }),
                t('agent.completion.sentence.readyWhenYouAre'),
              ]}
            />
            <Text fontSize={isMobile ? 14 : 16} type={'secondary'}>
              {t('agent.completionSubtitle')}
            </Text>
            <Button
              block={isMobile}
              size={'large'}
              style={{ marginTop: 8 }}
              type={'primary'}
              onClick={() => {
                // The original signup target takes priority over continuing the onboarding topic
                const target = consumeOnboardingCallbackUrl() || finishTargetUrl;
                if (target) window.location.assign(target);
              }}
            >
              {t('agent.enterApp')}
            </Button>
            {showFeedback && topicId && (
              <FeedbackPanel hasPriorFeedback={!!feedbackSubmitted} topicId={topicId} />
            )}
          </Flexbox>
          <MessengerIntegrations />
        </Flexbox>
      </Center>
    );
  },
);

CompletionPanel.displayName = 'CompletionPanel';

export default CompletionPanel;
