import { Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useTaskStore } from '@/store/task';

import { styles } from './style';
import { taskDetailPath } from './taskDetailPath';

interface BreadcrumbProps {
  taskId?: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const taskTitle = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId]?.name : undefined));
  const taskIdentifier = useTaskStore((s) =>
    taskId ? s.taskDetailMap[taskId]?.identifier : undefined,
  );
  const ancestors = useTaskStore(
    useShallow((s) => {
      if (!taskId) return [];
      const chain: Array<{ agentId?: string | null; identifier: string }> = [];
      const visited = new Set<string>([taskId]);
      let cursor = s.taskDetailMap[taskId]?.parent;
      while (cursor?.identifier && !visited.has(cursor.identifier)) {
        const detail = s.taskDetailMap[cursor.identifier];
        visited.add(cursor.identifier);
        chain.push({
          agentId: cursor.agentId === undefined ? detail?.agentId : cursor.agentId,
          identifier: cursor.identifier,
        });
        cursor = detail?.parent;
      }
      return chain.reverse();
    }),
  );

  const allTasksLabel = (
    <Text color={'inherit'} weight={500}>
      {t('taskList.all')}
    </Text>
  );

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
          title: taskId ? (
            <WorkspaceLink to={'/tasks'}>{allTasksLabel}</WorkspaceLink>
          ) : (
            allTasksLabel
          ),
        },
        ...ancestorCrumbs,
        ...(currentTaskCrumb ? [currentTaskCrumb] : []),
      ]}
    />
  );
});

export default Breadcrumb;
