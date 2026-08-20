'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import ToolAuthAlert from '@/features/Conversation/AgentWelcome/ToolAuthAlert';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import AgentInfo from './AgentInfo';
import OpeningQuestions from './OpeningQuestions';
import { useWelcomeExtra } from './WelcomeExtraContext';

interface AgentHomeProps {
  /** Omits owner-only and interactive welcome content on view-only share surfaces. */
  readOnly?: boolean;
}

const AgentHome = memo<AgentHomeProps>(({ readOnly = false }) => {
  const openingQuestions = useAgentStore(agentSelectors.openingQuestions, isEqual);
  const extra = useWelcomeExtra();

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox gap={32} style={{ paddingBottom: 'max(4vh, 16px)' }} width={'100%'}>
        <AgentInfo />
        {!readOnly && extra}
        {!readOnly && openingQuestions.length > 0 && (
          <OpeningQuestions questions={openingQuestions} />
        )}
        {!readOnly && <ToolAuthAlert />}
      </Flexbox>
    </>
  );
});

export default AgentHome;
