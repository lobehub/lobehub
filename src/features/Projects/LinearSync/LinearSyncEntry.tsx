'use client';

import { memo } from 'react';

import { useLinearIntegration } from '@/features/Integrations/useLinearIntegration';
import { useTaskStore } from '@/store/task';

import { useCanManageProject } from '../useCanManageProject';
import ImportTrigger from './ImportTrigger';
import { useLinearSyncRules } from './SyncRules';
import { useLinearSyncJobNotifier, useLinearSyncJobs } from './useLinearSyncJobs';

interface LinearSyncEntryProps {
  projectId: string;
}

/**
 * The project task list's shortcut into a Linear import. Shown only to
 * members who can manage the project once a Linear workspace is connected,
 * so projects that do not use Linear see nothing.
 */
const LinearSyncEntry = memo<LinearSyncEntryProps>(({ projectId }) => {
  const { connections, enabled } = useLinearIntegration();
  const canManage = useCanManageProject();
  const shown = enabled && canManage;
  const syncRules = useLinearSyncRules(shown ? projectId : null);
  const syncJobs = useLinearSyncJobs(shown ? projectId : null);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const refreshTaskLabels = useTaskStore((s) => s.refreshTaskLabels);
  // A sync started here may end after its dialog was closed; its tasks then
  // appear in the list below, along with any labels it created.
  useLinearSyncJobNotifier(syncJobs.data, () => {
    void refreshTaskList();
    void refreshTaskLabels();
  });

  if (!shown) return null;

  return (
    <ImportTrigger
      connections={connections}
      projectId={projectId}
      variant={'icon'}
      onSynced={() => {
        void syncRules.mutate();
        void syncJobs.mutate();
      }}
    />
  );
});

LinearSyncEntry.displayName = 'ProjectLinearSyncEntry';

export default LinearSyncEntry;
