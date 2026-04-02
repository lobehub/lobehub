import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ClipboardList, LayoutGrid, LayoutList } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import { styles } from './style';

const TasksHeader = memo(() => {
  const { t } = useTranslation('chat');
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const setViewMode = useTaskStore((s) => s.setViewMode);

  return (
    <div className={styles.header}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={ClipboardList} size={18} />
        <Text style={{ fontSize: 15 }} weight="bold">
          {t('taskList.activeTasks')}
        </Text>
      </Flexbox>
      <div className={styles.switchGroup}>
        <ActionIcon
          icon={LayoutList}
          size="small"
          style={{
            background: viewMode === 'list' ? cssVar.colorFillTertiary : 'transparent',
            borderRadius: 4,
          }}
          onClick={() => setViewMode('list')}
        />
        <ActionIcon
          icon={LayoutGrid}
          size="small"
          style={{
            background: viewMode === 'kanban' ? cssVar.colorFillTertiary : 'transparent',
            borderRadius: 4,
          }}
          onClick={() => setViewMode('kanban')}
        />
      </div>
    </div>
  );
});

export default TasksHeader;
