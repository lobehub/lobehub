'use client';

import type { FormFieldProps } from '@lobehub/ui';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import { LinkIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsWorkspaceViewer } from '@/business/client/hooks/useIsWorkspaceViewer';
import AsyncError from '@/components/AsyncError';
import { useLinearIntegration } from '@/features/Integrations/useLinearIntegration';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import ImportTrigger from './ImportTrigger';
import SyncJobs from './SyncJobs';
import SyncRules, { useLinearSyncRules } from './SyncRules';
import { useLinearSyncJobNotifier, useLinearSyncJobs } from './useLinearSyncJobs';

const LINEAR_SETTINGS_PATH = '/settings/integrations/linear';

/**
 * Project settings → Advanced → "Sync from Linear": a settings row that
 * imports Linear issues as this project's tasks, plus the project's saved
 * sync rules and recent background syncs below the settings form. Syncing is one way; Linear is only
 * read. Connecting a Linear workspace stays in Settings → Integrations,
 * shared by every project in the scope. A deployment without a Linear app,
 * and no connection left, contributes nothing.
 */
export const useProjectLinearSync = (
  projectId: string,
): { item: FormFieldProps | null; rules: ReactNode } => {
  const { t } = useTranslation('integration');
  const navigate = useWorkspaceAwareNavigate();
  const { config, connections, error, isInitialLoading, mutate } = useLinearIntegration();
  const syncRules = useLinearSyncRules(projectId);
  const syncJobs = useLinearSyncJobs(projectId);
  // A rule's last run is written when its job ends, not when it starts.
  useLinearSyncJobNotifier(syncJobs.data, () => void syncRules.mutate());
  const refresh = () => {
    void syncRules.mutate();
    void syncJobs.mutate();
  };
  // Viewers can see what is synced but cannot create tasks.
  const isViewer = useIsWorkspaceViewer();

  if (error && isInitialLoading) {
    return { item: null, rules: <AsyncError error={error} variant={'block'} onRetry={mutate} /> };
  }
  if (isInitialLoading || (!config?.enabled && connections.length === 0)) {
    return { item: null, rules: null };
  }

  const connected = connections.length > 0;
  return {
    item: {
      children: connected ? (
        <ImportTrigger
          connections={connections}
          disabled={isViewer}
          projectId={projectId}
          variant={'button'}
          onSynced={refresh}
        />
      ) : (
        <Button icon={<Icon icon={LinkIcon} />} onClick={() => navigate(LINEAR_SETTINGS_PATH)}>
          {t('linear.sync.project.connect')}
        </Button>
      ),
      desc: connected
        ? t('linear.sync.project.description')
        : t('linear.sync.project.noConnection'),
      label: t('linear.sync.project.title'),
      minWidth: undefined,
    },
    // Rules outlive a disconnect, so they stay listed and removable.
    rules: (
      <Flexbox gap={16}>
        <SyncRules
          connections={connections}
          jobs={syncJobs.data ?? []}
          projectId={projectId}
          onJobStarted={refresh}
        />
        <SyncJobs jobs={syncJobs.data ?? []} rules={syncRules.data ?? []} />
      </Flexbox>
    ),
  };
};
