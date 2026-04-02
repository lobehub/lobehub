import { Flexbox, Icon, Text } from '@lobehub/ui';
import { ClipboardList } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

const TaskListHeader = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <div className={styles.header}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={ClipboardList} size={16} />
        <Text weight="bold">{t('taskList.title')}</Text>
      </Flexbox>
      <span className={styles.viewAll}>{t('taskList.viewAll')}</span>
    </div>
  );
});

export default TaskListHeader;
