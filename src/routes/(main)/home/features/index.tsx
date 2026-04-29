'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { RecommendTaskTemplates } from '@/business/client/RecommendTaskTemplates';
import DailyBrief from '@/features/DailyBrief';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import AgentSelect from './AgentSelect';
import CommunityAgents from './CommunityAgents';
import InputArea from './InputArea';
import WelcomeText from './WelcomeText';

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);

  return (
    <Flexbox gap={40}>
      <Flexbox gap={24}>
        <Flexbox gap={4}>
          <AgentSelect />
          <WelcomeText />
        </Flexbox>
        <InputArea />
      </Flexbox>

      {isLogin && enableAgentTask && (
        <Flexbox gap={40}>
          <DailyBrief />
          <RecommendTaskTemplates />
        </Flexbox>
      )}
      {!enableAgentTask && <CommunityAgents />}
    </Flexbox>
  );
});

export default Home;
