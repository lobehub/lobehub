import { ActionIcon, Flexbox } from '@lobehub/ui';
import { BotMessageSquareIcon, Settings2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { useAgentStore } from '@/store/agent';

import AgentForkTag from './AgentForkTag';
import AgentStatusTag from './AgentStatusTag';
import AgentVersionReviewTag from './AgentVersionReviewTag';
import AutoSaveHint from './AutoSaveHint';

const Header = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <NavHeader
      right={
        <Flexbox horizontal align={'center'} gap={4}>
          <ActionIcon
            icon={Settings2Icon}
            size={DESKTOP_HEADER_ICON_SIZE}
            title={t('advancedSettings')}
            onClick={() => useAgentStore.setState({ showAgentSetting: true })}
          />
          <ToggleRightPanelButton icon={BotMessageSquareIcon} showActive={true} />
        </Flexbox>
      }
      left={
        <Flexbox horizontal gap={8}>
          <AutoSaveHint />
          <AgentStatusTag />
          <AgentVersionReviewTag />
          <AgentForkTag />
        </Flexbox>
      }
    />
  );
});

export default Header;
