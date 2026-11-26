import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import EnvironmentForm, {
  type EnvironmentFormValue,
} from '@/features/EnvironmentManager/EnvironmentForm';
import EnvironmentSummary from '@/features/EnvironmentManager/EnvironmentSummary';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import type { SandboxEnvironmentSpecification } from '@/services/environment';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { EnvironmentNotes } from './EnvironmentNotes';
import { ExecutionEnvironments } from './ExecutionEnvironments';

interface ProjectSettingsTabProps {
  /** Whether the caller may change the project, and so its environment. */
  canManage?: boolean;
  projectId: string;
}

/**
 * Where the project's work can run, in the priority a new conversation
 * follows: the cloud sandbox and every device with its workspace folder.
 * What gets checked out there, and how, is the environment, on its own tab.
 */
export function ProjectRunners({ canManage, projectId }: ProjectSettingsTabProps) {
  useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const [environment] = useProjectEnvironments(projectId);

  return (
    <ExecutionEnvironments
      canManage={!!canManage}
      environmentId={environment?.id}
      projectId={projectId}
    />
  );
}

/**
 * What every runner prepares before work starts, whichever one it is: the
 * repositories it checks out, the setup that runs, the variables every
 * command sees — and notes on what a run needs from a machine.
 */
export function ProjectEnvironment({ canManage, projectId }: ProjectSettingsTabProps) {
  const { t } = useTranslation('project');
  const request = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const updateEnvironment = useProjectDirectoryStore((s) => s.updateProjectEnvironment);
  const [environment] = useProjectEnvironments(projectId);

  const save = async (changes: {
    configuration?: SandboxEnvironmentSpecification;
    description?: string;
  }) => {
    await updateEnvironment({
      projectId,
      ...(changes.configuration && { configuration: changes.configuration }),
      ...(changes.description !== undefined && { description: changes.description }),
    });
  };

  if (request.error && !environment)
    return <AsyncError error={request.error} onRetry={() => request.revalidate()} />;
  if (!request.hasData || !environment) return <EnvironmentListSkeleton />;

  const value: EnvironmentFormValue = environment;
  const form: ReactNode = canManage ? (
    <EnvironmentForm
      hideBasics
      hideRepositoryHints
      envNotice={t('settings.envSandboxOnly')}
      environment={value}
      onSave={save}
    />
  ) : (
    <EnvironmentSummary environment={value} />
  );

  return (
    <>
      {form}
      <EnvironmentNotes
        canManage={!!canManage}
        notes={environment.configuration?.notes}
        // The stored definition goes back whole, as the form sends it: an edit
        // replaces the configuration rather than merging into it.
        onSave={(notes) =>
          save({
            configuration: {
              ...(environment.configuration as SandboxEnvironmentSpecification),
              notes: notes || undefined,
            },
          })
        }
      />
    </>
  );
}
