import { agentDisplayName } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import isEqual from 'fast-deep-equal';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useTaskProjection } from '@/projection/modules/task/projectionHooks';
import { findTaskRecordByIdentity, selectTaskDetail } from '@/projection/modules/task/selectors';

import { styles } from './style';
import { taskDetailPath } from './taskDetailPath';
import { useAgentDisplayMeta } from './useAgentDisplayMeta';

interface BreadcrumbProps {
  taskId?: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const { aid } = useParams<{ aid?: string }>();
  const agentMeta = useAgentDisplayMeta(aid);
  const { ancestors, taskIdentifier, taskTitle } = useTaskProjection((scope) => {
    if (!taskId) return { ancestors: [], taskIdentifier: undefined, taskTitle: undefined };
    const current = selectTaskDetail(findTaskRecordByIdentity(scope, taskId));
    const chain: Array<{ agentId?: string | null; identifier: string }> = [];
    const visited = new Set<string>([taskId]);
    let cursor = current?.parent;
    while (cursor?.identifier && !visited.has(cursor.identifier)) {
      const detail = selectTaskDetail(findTaskRecordByIdentity(scope, cursor.identifier));
      visited.add(cursor.identifier);
      chain.push({
        agentId: cursor.agentId === undefined ? detail?.agentId : cursor.agentId,
        identifier: cursor.identifier,
      });
      cursor = detail?.parent;
    }
    return {
      ancestors: chain.reverse(),
      taskIdentifier: current?.identifier,
      taskTitle: current?.name,
    };
  }, isEqual);

  const allTasksLabel = (
    <Text color={'inherit'} weight={500}>
      {t('taskList.all')}
    </Text>
  );

  const agentCrumb =
    aid && agentMeta
      ? {
          key: `agent-${aid}`,
          title: (
            <Text
              ellipsis
              color={'inherit'}
              style={{ maxWidth: 160 }}
              type={taskId ? undefined : 'secondary'}
              weight={500}
            >
              {agentDisplayName(agentMeta)}
            </Text>
          ),
        }
      : undefined;

  // The agent crumb links to its task list only when it is not the current page
  // (i.e. when a deeper task crumb follows it).
  const agentCrumbNode =
    agentCrumb && taskId
      ? {
          ...agentCrumb,
          title: <WorkspaceLink to={`/agent/${aid}/tasks`}>{agentCrumb.title}</WorkspaceLink>,
        }
      : agentCrumb;

  const ancestorCrumbs = ancestors.map(({ identifier, agentId }) => ({
    key: identifier,
    title: (
      <WorkspaceLink to={taskDetailPath(identifier, agentId ?? undefined)}>
        <Text color={'inherit'} weight={500}>
          {identifier}
        </Text>
      </WorkspaceLink>
    ),
  }));

  const currentTaskCrumb = taskId
    ? {
        title: (
          <span
            style={{
              alignItems: 'center',
              display: 'inline-flex',
              gap: 6,
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            {taskIdentifier && (
              <Text
                as={'span'}
                color={'inherit'}
                style={{ flexShrink: 0 }}
                type={'secondary'}
                weight={500}
              >
                {taskIdentifier}
              </Text>
            )}
            <Text
              ellipsis
              as={'span'}
              color={'inherit'}
              style={{ flex: '1 1 auto', maxWidth: 240, minWidth: 0 }}
              weight={500}
            >
              {taskTitle || taskId}
            </Text>
          </span>
        ),
      }
    : undefined;

  return (
    <AntBreadcrumb
      className={styles.breadcrumb}
      separator={<Icon icon={ChevronRight} />}
      items={[
        {
          title:
            taskId || agentCrumbNode ? (
              <WorkspaceLink to={'/tasks'}>{allTasksLabel}</WorkspaceLink>
            ) : (
              allTasksLabel
            ),
        },
        ...(agentCrumbNode ? [agentCrumbNode] : []),
        ...ancestorCrumbs,
        ...(currentTaskCrumb ? [currentTaskCrumb] : []),
      ]}
    />
  );
});

export default Breadcrumb;
