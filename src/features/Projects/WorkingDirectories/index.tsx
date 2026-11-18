import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderGit2Icon, FolderIcon, KeyRoundIcon, TerminalIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import EnvironmentForm, {
  type EnvironmentFormValue,
} from '@/features/EnvironmentManager/EnvironmentForm';
import PanelSection from '@/features/EnvironmentManager/PanelSection';
import { repositoryPaths } from '@/features/EnvironmentManager/repository';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { SandboxEnvironmentSpecification } from '@/services/environment';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';

const styles = stylex.create({
  card: {
    paddingBlock: '16px',
    paddingInline: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
});

interface ProjectWorkingDirectoriesProps {
  /** Whether the caller may change the project, and so its environment. */
  canManage?: boolean;
  projectId: string;
}

/**
 * The project's environment, laid out in full: the repositories it checks out
 * (any number, or none), the setup that runs after, and the variables every
 * command sees. Every project has exactly one, made with it — there is nothing
 * to link, pick or create here, only the environment itself to fill in.
 */
export function ProjectWorkingDirectories({
  canManage,
  projectId,
}: ProjectWorkingDirectoriesProps) {
  const { t } = useTranslation(['project', 'setting']);
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
      <Flexbox gap={16}>
        <Flexbox {...stylex.props(styles.card)}>
          <EnvironmentForm hideBasics environment={value} section="settings" onSave={save} />
        </Flexbox>
        <Flexbox {...stylex.props(styles.card)}>
          <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 8 }}>
            <Icon icon={KeyRoundIcon} size={16} style={{ color: cssVar.colorTextSecondary }} />
            <Text weight={600}>{t('environments.form.env', { ns: 'setting' })}</Text>
          </Flexbox>
          <EnvironmentForm hideBasics environment={value} section="variables" onSave={save} />
        </Flexbox>
      </Flexbox>
    ) : (
      <ProjectEnvironmentSummary environment={value} />
    );
  }

  const folderCount = directoriesRequest.hasData ? directories.length : undefined;

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Text fontSize={16} weight={600}>
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

/** What a member who cannot change the project reads: what the environment will do. */
function ProjectEnvironmentSummary({ environment }: { environment: EnvironmentFormValue }) {
  const { t } = useTranslation('setting');
  const configuration = environment.configuration ?? {};
  const repositories = repositoryPaths(configuration);
  const variables = Object.keys(configuration.env ?? {});

  return (
    <Flexbox {...stylex.props(styles.card)}>
      <PanelSection icon={FolderGit2Icon} title={t('environments.form.sources')}>
        {repositories.length > 0 ? (
          repositories.map((repository) => (
            <Text fontSize={13} key={repository}>
              {repository}
            </Text>
          ))
        ) : (
          <Text fontSize={13} type="secondary">
            {t('environments.detail.noRepository')}
          </Text>
        )}
      </PanelSection>
      <PanelSection icon={TerminalIcon} title={t('environments.form.bootstrap')}>
        <Text code={!!configuration.bootstrapCommand} fontSize={13}>
          {configuration.bootstrapCommand || t('environments.detail.noSetup')}
        </Text>
      </PanelSection>
      <PanelSection last icon={KeyRoundIcon} title={t('environments.form.env')}>
        <Text fontSize={13} type={variables.length ? undefined : 'secondary'}>
          {variables.length ? variables.join(', ') : t('environments.form.noVariables')}
        </Text>
      </PanelSection>
    </Flexbox>
  );
}
