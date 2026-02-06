import { Flexbox } from '@lobehub/ui';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import AgentForkTag from './AgentForkTag';
import AgentStatusTag from './AgentStatusTag';
import AgentVersionReviewTag from './AgentVersionReviewTag';
import AutoSaveHint from './AutoSaveHint';

const Header = memo(() => {
  return (
    <NavHeader
      left={
        <Flexbox gap={8} horizontal>
          <AutoSaveHint />
          <AgentStatusTag />
          <AgentVersionReviewTag />
          <AgentForkTag />
        </Flexbox>
      }
      right={
        <>
          <WideScreenButton />
          <ToggleRightPanelButton icon={BotMessageSquareIcon} showActive={true} />
        </>
      }
    />
  );
});

export default Header;
