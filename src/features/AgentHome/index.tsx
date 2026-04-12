'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import ToolAuthAlert from '@/routes/(main)/agent/features/Conversation/AgentWelcome/ToolAuthAlert';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import AgentInfo from './AgentInfo';
import OpeningQuestions from './OpeningQuestions';

const AgentHome = memo(() => {
  const openingQuestions = useAgentStore(agentSelectors.openingQuestions, isEqual);

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox gap={32} style={{ paddingBottom: 'max(4vh, 16px)' }} width={'100%'}>
        <AgentInfo />
        {openingQuestions.length > 0 && <OpeningQuestions questions={openingQuestions} />}
        <ToolAuthAlert />
      </Flexbox>
    </>
  );
});

export default AgentHome;
