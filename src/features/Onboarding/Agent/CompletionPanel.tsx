'use client';

import { Button, Center, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentMeta } from '@/features/Conversation/hooks/useAgentMeta';
import LobeMessage from '@/routes/onboarding/components/LobeMessage';

import { staticStyle } from './staticStyle';

interface CompletionPanelProps {
  finishTargetUrl?: string;
}

const CompletionPanel = memo<CompletionPanelProps>(({ finishTargetUrl }) => {
  const { t } = useTranslation('onboarding');
  const agentMeta = useAgentMeta();
  return (
    <Center height={'100%'} width={'100%'}>
      <Flexbox
        className={staticStyle.completionEnter}
        gap={14}
        style={{ maxWidth: 600, width: '100%' }}
      >
        <LobeMessage
          avatar={agentMeta.avatar}
          avatarSize={72}
          fontSize={32}
          gap={16}
          sentences={[
            t('agent.completion.sentence.readyWithName', { name: agentMeta.title }),
            t('agent.completion.sentence.readyWhenYouAre'),
          ]}
        />
        <Text fontSize={16} type={'secondary'}>
          {t('agent.completionSubtitle')}
        </Text>
        <Button
          size={'large'}
          style={{ marginTop: 8 }}
          type={'primary'}
          onClick={() => {
            if (finishTargetUrl) window.location.assign(finishTargetUrl);
          }}
        >
          {t('agent.enterApp')}
        </Button>
      </Flexbox>
    </Center>
  );
});

CompletionPanel.displayName = 'CompletionPanel';

export default CompletionPanel;
