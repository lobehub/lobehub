import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import AgentBuilderToggle from './AgentBuilderToggle';
import AutoSaveHint from './AutoSaveHint';

const Header = memo(() => {
  return (
    <NavHeader
      left={<AutoSaveHint />}
      right={
        <>
          <WideScreenButton />
          <AgentBuilderToggle />
          {/* TODO: Add GroupPublishButton when group publishing is supported */}
        </>
      }
    />
  );
});

export default Header;
