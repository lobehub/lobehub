import { ActionIcon } from '@lobehub/ui';
import { Maximize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useHeaderActionSize } from '@/styles/density';

import PortalHeader from '../components/Header';
import Title from './Title';
import { useOpenGoalPage } from './useOpenGoalPage';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const headerActionSize = useHeaderActionSize(true);
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
            size={headerActionSize}
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
