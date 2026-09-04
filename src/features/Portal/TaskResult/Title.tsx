import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';
import { oneLineEllipsis } from '@/styles';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskResultId);
  const detail = useTaskStore((state) => (taskId ? state.taskDetailMap[taskId] : undefined));

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
      <Text fontSize={14} weight={500}>
        {t('goalDetail.taskResult')}
      </Text>
      {(detail?.identifier || detail?.name) && (
        <Text
          className={oneLineEllipsis}
          fontSize={13}
          style={{ color: cssVar.colorTextSecondary, flex: 1, minWidth: 0 }}
        >
          {[detail.identifier, detail.name].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Flexbox>
  );
});

Title.displayName = 'TaskResultPortalTitle';
export default Title;
