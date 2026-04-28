'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import RecommendTaskTemplates from '@/business/client/RecommendTaskTemplates';
import DailyBrief from '@/features/DailyBrief';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

import CommunityAgents from './CommunityAgents';
import InputArea from './InputArea';
import WelcomeText from './WelcomeText';

const Home = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);

  // Hide other modules when a starter mode is active
  const hideOtherModules = inputActiveMode && ['agent', 'group', 'write'].includes(inputActiveMode);

  return (
    <Flexbox gap={40}>
      <WelcomeText />
      <InputArea />
      {isLogin && (
        <Flexbox gap={40} style={{ display: hideOtherModules ? 'none' : undefined }}>
          <DailyBrief />
          <RecommendTaskTemplates />
        </Flexbox>
      )}
      {/* Use CSS visibility to hide instead of unmounting to prevent data re-fetching */}
      <Flexbox gap={40} style={{ display: hideOtherModules ? 'none' : undefined }}>
        {isDevMode && <CommunityAgents />}
      </Flexbox>
    </Flexbox>
  );
});

export default Home;
