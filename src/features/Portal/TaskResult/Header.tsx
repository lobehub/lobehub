import { Button } from '@lobehub/ui/base-ui';
import { ListTodo } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import PortalHeader from '../components/Header';
import Title from './Title';

const Header = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskResultId);
  const openTaskDetail = useChatStore((state) => state.openTaskDetail);

  return (
    <PortalHeader
      title={<Title />}
      rightExtra={
        <Button
          disabled={!taskId}
          icon={ListTodo}
          size={'small'}
          type={'text'}
          onClick={() => taskId && openTaskDetail(taskId)}
        >
          {t('goalDetail.viewOriginalTask')}
        </Button>
      }
    />
  );
});

Header.displayName = 'TaskResultPortalHeader';
export default Header;
