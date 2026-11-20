import { Flexbox, Text } from '@lobehub/ui';
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
import { useDensityTokens } from '@/styles/density';

import { LocalDirectories } from './LocalDirectories';

interface ProjectWorkingDirectoriesProps {
  /** Whether the caller may change the project, and so its environment. */
  canManage?: boolean;
  projectId: string;
}

/**
 * The project's environment, laid out in full and flat — the same form an
 * environment's own page shows: the repositories it checks out (any number, or
 * none, each with its own setup), the setup that runs after, and the variables
 * every command sees. Every project has exactly one, made with it — there is nothing
 * to link, pick or create here, only the environment itself to fill in.
 *
 * The project's local folders sit right under the repositories: they are where
 * those repositories are checked out on the project's devices, and their order
 * is the device priority a local run follows.
 */
export function ProjectWorkingDirectories({
  canManage,
  projectId,
}: ProjectWorkingDirectoriesProps) {
  const { t } = useTranslation(['project', 'setting']);
  const { pageTitleFontSize } = useDensityTokens();
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

  let content: ReactNode;
  if (request.error && !environment) {
    content = <AsyncError error={request.error} onRetry={() => request.revalidate()} />;
  } else if (!request.hasData || !environment) {
    content = <EnvironmentListSkeleton />;
  } else {
    const value: EnvironmentFormValue = environment;
    const localDirectories = (
      <LocalDirectories
        canManage={!!canManage}
        environmentId={environment.id}
        projectId={projectId}
      />
    );
    content = canManage ? (
      <EnvironmentForm
        allowLocalOnly
        hideBasics
        environment={value}
        localDirectories={localDirectories}
        onSave={save}
      />
    ) : (
      <EnvironmentSummary environment={value} localDirectories={localDirectories} />
    );
  }

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Text fontSize={pageTitleFontSize} weight={600}>
          {t('settings.environments')}
        </Text>
        <Text type="secondary">{t('settings.environmentIntro')}</Text>
      </Flexbox>
      {content}
    </Flexbox>
  );
}
