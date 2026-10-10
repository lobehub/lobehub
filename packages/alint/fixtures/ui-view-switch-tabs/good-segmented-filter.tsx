// Fixture: a Segmented that only filters the same list.
import { Flexbox } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TaskList from './TaskList';

const TaskFilterList = memo(() => {
  const { t } = useTranslation('task');
  const [scope, setScope] = useState<'all' | 'mine'>('all');

  return (
    <Flexbox gap={8}>
      <Segmented
        value={scope}
        options={[
          { label: t('filter.all'), value: 'all' },
          { label: t('filter.mine'), value: 'mine' },
        ]}
        onChange={(value) => setScope(value as 'all' | 'mine')}
      />
      <TaskList scope={scope} />
    </Flexbox>
  );
});

export default TaskFilterList;
