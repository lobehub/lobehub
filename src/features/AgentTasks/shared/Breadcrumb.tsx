import { DEFAULT_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';

interface BreadcrumbProps {
  /**
   * When omitted, the breadcrumb renders a single "All tasks" crumb for the
   * cross-agent `/tasks` route.
   */
  agentId?: string;
  taskId?: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ agentId, taskId }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentMeta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );
  const taskTitle = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId]?.name : undefined));
  const ancestors = useTaskStore(
    useShallow((s) => {
      if (!taskId) return [];
      const chain: string[] = [];
      const visited = new Set<string>([taskId]);
      let cursor = s.taskDetailMap[taskId]?.parent?.identifier;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        chain.push(cursor);
        cursor = s.taskDetailMap[cursor]?.parent?.identifier;
      }
      return chain.reverse();
    }),
  );

  if (!agentId) {
    return (
      <AntBreadcrumb
        separator={<Icon icon={ChevronRight} />}
        items={[
          {
            title: (
              <Text color={'inherit'} weight={500}>
                {t('taskList.all')}
              </Text>
            ),
          },
        ]}
      />
    );
  }

  const isInboxAgent = agentId === INBOX_SESSION_ID || (!!inboxAgentId && agentId === inboxAgentId);
  const agentName =
    agentMeta?.title?.trim() || (isInboxAgent ? t('inbox.title') : tCommon('defaultSession'));
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
        ...ancestors.map((identifier) => ({
          key: identifier,
          title: (
            <Link to={`/agent/${agentId}/tasks/${identifier}`}>
              <Text color={'inherit'} weight={500}>
                {identifier}
              </Text>
            </Link>
          ),
        })),
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
