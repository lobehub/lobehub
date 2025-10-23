import { ActionIcon, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { StopCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { shinyTextStylish } from '@/styles/loading';

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    .show-on-hover {
      opacity: 0;
      transition: all ease-in-out 0.3ms;
    }

    :hover {
      .show-on-hover {
        opacity: 1;
      }
    }
  `,

  shinyText: shinyTextStylish(token),
}));

const SupervisorThinkingTag = memo(() => {
  const { t } = useTranslation('chat');
  const activeGroupId = useSessionStore((s) => s.activeId);
  const isSupervisorLoading = useChatStore(chatSelectors.isSupervisorLoading(activeGroupId || ''));
  const cancelSupervisorDecision = useChatStore((s) => s.internal_cancelSupervisorDecision);
  const { styles } = useStyles();

  if (!isSupervisorLoading) return null;

  return (
    <Center className={styles.container} gap={4} horizontal paddingBlock={'12px 24px'}>
      <Text className={styles.shinyText} type={'secondary'}>
        {t('group.orchestratorThinking')}
      </Text>
      <ActionIcon
        icon={StopCircle}
        onClick={(e) => {
          e.stopPropagation();
          cancelSupervisorDecision(activeGroupId);
        }}
        size={'small'}
        title={t('groupSidebar.members.stopOrchestrator')}
      />
    </Center>
  );
});

export default SupervisorThinkingTag;
