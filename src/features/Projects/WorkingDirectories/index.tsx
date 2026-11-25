import AsyncError from '@/components/AsyncError';
import EnvironmentForm, {
  type EnvironmentFormValue,
} from '@/features/EnvironmentManager/EnvironmentForm';
import EnvironmentSummary from '@/features/EnvironmentManager/EnvironmentSummary';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import type { SandboxEnvironmentSpecification } from '@/services/environment';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { ExecutionEnvironments } from './ExecutionEnvironments';

interface ProjectSettingsTabProps {
  /** Whether the caller may change the project, and so its devices and environment. */
  canManage?: boolean;
  projectId: string;
}

/**
 * The project's run devices, in priority order: the cloud sandbox and each
 * device with the workspace root to work under.
 */
export function ProjectRunDevices({ canManage, projectId }: ProjectSettingsTabProps) {
  // A new device is linked to the project's environment, made with the project.
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
 * The project's one environment: what any run device prepares before work
 * starts — the repositories to check out, the setup that runs, the variables
 * every command sees — and run notes the agent reads when it picks a device.
 */
export function ProjectEnvironmentSettings({ canManage, projectId }: ProjectSettingsTabProps) {
  const request = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const updateEnvironment = useProjectDirectoryStore((s) => s.updateProjectEnvironment);
  const [environment] = useProjectEnvironments(projectId);

  if (request.error && !environment)
    return <AsyncError error={request.error} onRetry={() => request.revalidate()} />;
  if (!request.hasData || !environment) return <EnvironmentListSkeleton />;

  const value: EnvironmentFormValue = environment;
  if (!canManage) return <EnvironmentSummary environment={value} />;

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

  return (
    <EnvironmentForm
      hideBasics
      hideRepositoryHints
      showRunNotes
      environment={value}
      onSave={save}
    />
  );
}
