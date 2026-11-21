import { layoutRepositorySources } from '@lobechat/types';
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
import { deviceSelectors, useDeviceStore } from '@/store/device';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';
import { useDensityTokens } from '@/styles/density';

import { LocalDirectories } from './LocalDirectories';
import { RepositoryLocations } from './RepositoryLocations';

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
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const directories = useProjectDirectories(projectId);
  useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);

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
    // Each repository's folder inside a project folder, laid out as a checkout lays it out.
    const folders = new Map(
      layoutRepositorySources(environment.configuration?.sources ?? []).flatMap((source) =>
        source.kind === 'git'
          ? [
              [
                source.url,
                source.path
                  ?.trim()
                  .replace(/^\.?\/+/, '')
                  .replace(/\/+$/, ''),
              ],
            ]
          : [],
      ),
    );
    const renderRepositoryLocations = (source: { localOnly?: boolean; url: string }) =>
      directoriesRequest.hasData ? (
        <RepositoryLocations
          devices={devices}
          directories={directories}
          folder={folders.get(source.url) || undefined}
          localOnly={source.localOnly}
        />
      ) : null;
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
        renderRepositoryLocations={renderRepositoryLocations}
        onSave={save}
      />
    ) : (
      <EnvironmentSummary
        environment={value}
        localDirectories={localDirectories}
        renderRepositoryLocations={renderRepositoryLocations}
      />
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
