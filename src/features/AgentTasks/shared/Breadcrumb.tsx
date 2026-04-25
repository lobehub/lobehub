import { DEFAULT_AVATAR } from '@lobechat/const';
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

import { isInboxAgentId } from './isInboxAgent';
import { styles } from './style';

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
  const taskIdentifier = useTaskStore((s) =>
    taskId ? s.taskDetailMap[taskId]?.identifier : undefined,
  );
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

  const isInboxAgent = isInboxAgentId(agentId, inboxAgentId);
  const agentName =
    agentMeta?.title?.trim() || (isInboxAgent ? t('inbox.title') : tCommon('defaultSession'));
  const agentAvatar = agentMeta?.avatar || (isInboxAgent ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR);

  return (
    <AntBreadcrumb
      className={styles.breadcrumb}
      separator={<Icon icon={ChevronRight} />}
      items={[
        {
          title: (
            <Link to={`/agent/${agentId}`}>
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                style={{ minWidth: 0, overflow: 'hidden' }}
              >
                <Flexbox style={{ flexShrink: 0 }}>
                  <Avatar avatar={agentAvatar} background={agentMeta?.backgroundColor} size={18} />
                </Flexbox>
                <Text ellipsis color={'inherit'} weight={500}>
                  {agentName}
                </Text>
              </Flexbox>
            </Link>
          ),
        },
        ...(taskId
          ? []
          : [
              {
                title: (
                  <Link to={`/agent/${agentId}/tasks`}>
                    <Text color={'inherit'} weight={500}>
                      {t('taskList.breadcrumb.task')}
                    </Text>
                  </Link>
                ),
              },
            ]),
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
                  <span
                    style={{
                      alignItems: 'center',
                      display: 'inline-flex',
                      gap: 6,
                      lineHeight: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {taskIdentifier && (
                      <Text
                        color={'inherit'}
                        style={{ flexShrink: 0 }}
                        type={'secondary'}
                        weight={500}
                      >
                        {taskIdentifier}
                      </Text>
                    )}
                    <Text ellipsis color={'inherit'} style={{ maxWidth: 240 }} weight={500}>
                      {taskTitle || taskId}
                    </Text>
                  </span>
                ),
              },
            ]
          : []),
      ]}
    />
  );
});

export default Breadcrumb;
