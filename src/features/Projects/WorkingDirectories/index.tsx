import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { FolderIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import EnvironmentForm, {
  type EnvironmentFormValue,
} from '@/features/EnvironmentManager/EnvironmentForm';
import EnvironmentSummary from '@/features/EnvironmentManager/EnvironmentSummary';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { SandboxEnvironmentSpecification } from '@/services/environment';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';
import { useDensityTokens } from '@/styles/density';

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
 */
export function ProjectWorkingDirectories({
  canManage,
  projectId,
}: ProjectWorkingDirectoriesProps) {
  const { t } = useTranslation(['project', 'setting']);
  const { pageTitleFontSize } = useDensityTokens();
  const navigate = useWorkspaceAwareNavigate();
  const request = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const updateEnvironment = useProjectDirectoryStore((s) => s.updateProjectEnvironment);
  const [environment] = useProjectEnvironments(projectId);
  const directories = useProjectDirectories(projectId);

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
    content = canManage ? (
      <EnvironmentForm hideBasics environment={value} onSave={save} />
    ) : (
      <EnvironmentSummary environment={value} />
    );
  }

  const folderCount = directoriesRequest.hasData ? directories.length : undefined;

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Text fontSize={pageTitleFontSize} weight={600}>
            {t('settings.environments')}
          </Text>
          {folderCount !== undefined && (
            <Button
              icon={<Icon icon={FolderIcon} />}
              onClick={() => navigate(`/project/${projectId}/settings/directories`)}
            >
              {t(folderCount ? 'settings.viewDirectories' : 'settings.configureDirectory', {
                count: folderCount,
              })}
            </Button>
          )}
        </Flexbox>
        <Text type="secondary">{t('settings.environmentIntro')}</Text>
      </Flexbox>
      {content}
    </Flexbox>
  );
}
