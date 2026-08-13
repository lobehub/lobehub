'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import ToolAuthAlert from '@/routes/(main)/agent/features/Conversation/AgentWelcome/ToolAuthAlert';
import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';

import AgentInfo from './AgentInfo';
import OpeningQuestions from './OpeningQuestions';
import { useWelcomeExtra } from './WelcomeExtraContext';

const AgentHome = memo(() => {
  const openingQuestions = useCurrentAgentValue(agentProjectionSelectors.openingQuestions);
  const extra = useWelcomeExtra();

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox gap={32} style={{ paddingBottom: 'max(4vh, 16px)' }} width={'100%'}>
        <AgentInfo />
        {extra}
        {openingQuestions.length > 0 && <OpeningQuestions questions={openingQuestions} />}
        <ToolAuthAlert />
      </Flexbox>
    </>
  );
});

export default AgentHome;
