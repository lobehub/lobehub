import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import PortalHeader from '../components/Header';
import Title from './Title';
import { useOpenGoalPage } from './useOpenGoalPage';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('chat');
  const goalId = useChatStore(chatPortalSelectors.goalPortalId);
  const openGoalPage = useOpenGoalPage(goalId);

  return (
    <PortalHeader
      title={<Title />}
      rightExtra={
        openGoalPage && (
          <ActionIcon
            aria-label={t('goalProcess.portal.openPage')}
            icon={Maximize2Icon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('goalProcess.portal.openPage')}
            onClick={openGoalPage}
          />
        )
      }
      onClose={onClose}
    />
  );
});

Header.displayName = 'GoalPortalHeader';

export default Header;
