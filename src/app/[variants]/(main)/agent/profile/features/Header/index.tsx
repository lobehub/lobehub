import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import AutoSaveHint from './AutoSaveHint';

const Header = memo(() => {
  return (
    <NavHeader
      left={<AutoSaveHint />}
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
