import { DEFAULT_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';

interface BreadcrumbProps {
  agentId: string;
  taskId?: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ agentId, taskId }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentMeta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const taskTitle = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId]?.name : undefined));

  const isInboxAgent = agentId === INBOX_SESSION_ID || (!!inboxAgentId && agentId === inboxAgentId);
  const agentName =
    agentMeta?.title?.trim() || (isInboxAgent ? 'Lobe AI' : tCommon('defaultSession'));
  const agentAvatar = agentMeta?.avatar || (isInboxAgent ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR);

  return (
    <AntBreadcrumb
      separator={<Icon icon={ChevronRight} />}
      items={[
        {
          title: (
            <Link to={`/agent/${agentId}`}>
              <Flexbox horizontal align={'center'} gap={6}>
                <Avatar avatar={agentAvatar} background={agentMeta?.backgroundColor} size={18} />
                <Text color={'inherit'} weight={500}>
                  {agentName}
                </Text>
              </Flexbox>
            </Link>
          ),
        },
        {
          title: (
            <Link to={`/agent/${agentId}/tasks`}>
              <Text color={'inherit'} weight={500}>
                {t('taskList.breadcrumb.task')}
              </Text>
            </Link>
          ),
        },
        ...(taskId
          ? [
              {
                title: (
                  <Text color={'inherit'} weight={500}>
                    {taskTitle || taskId}
                  </Text>
                ),
              },
            ]
          : []),
      ]}
    />
  );
});

export default Breadcrumb;
