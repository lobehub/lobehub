import { Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import EnvironmentForm, {
  type EnvironmentFormValue,
} from '@/features/EnvironmentManager/EnvironmentForm';
import EnvironmentSummary from '@/features/EnvironmentManager/EnvironmentSummary';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import type { SandboxEnvironmentSpecification } from '@/services/environment';
import { useProjectDirectoryStore, useProjectEnvironments } from '@/store/projectWorkingDirectory';

import { LocalDirectories } from './LocalDirectories';

interface ProjectWorkingDirectoriesProps {
  /** Whether the caller may change the project, and so its environment. */
  canManage?: boolean;
  projectId: string;
}

/** One of the two places a project conversation runs; open until folded. */
const Group = ({ children, title }: { children: ReactNode; title: string }) => {
  const [open, setOpen] = useState(true);
  const toggle = () => setOpen((value) => !value);

  return (
    <Flexbox gap={4}>
      <Flexbox
        horizontal
        align="center"
        aria-expanded={open}
        gap={8}
        paddingBlock={4}
        role="button"
        style={{ cursor: 'pointer' }}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
      >
        <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} size={16} />
        <Text fontSize={16} weight={600}>
          {title}
        </Text>
      </Flexbox>
      {open && children}
    </Flexbox>
  );
};

/**
 * Where the project's conversations run, one place at a time, each with only
 * what it needs:
 *
 * - The cloud sandbox, where a new conversation starts by default: the
 *   project's environment — the repositories it clones, the setup that runs
 *   and the variables every command sees. Every project has exactly one,
 *   made with it, so there is nothing to link or pick, only to fill in.
 * - Devices: the project's folders on connected machines, where the
 *   repositories already are. Their order is the device priority a new
 *   conversation follows.
 *
 * A repository the cloud sandbox skips lives in the device folders only, so
 * it says so when the project has none.
 */
export function ProjectWorkingDirectories({
  canManage,
  projectId,
}: ProjectWorkingDirectoriesProps) {
  const { t } = useTranslation(['project', 'setting']);
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

  let cloud: ReactNode;
  if (request.error && !environment) {
    cloud = <AsyncError error={request.error} onRetry={() => request.revalidate()} />;
  } else if (!request.hasData || !environment) {
    cloud = <EnvironmentListSkeleton />;
  } else {
    const value: EnvironmentFormValue = environment;
    cloud = canManage ? (
      <EnvironmentForm
        collapseSetup
        hideBasics
        hideRepositoryHints
        environment={value}
        onSave={save}
      />
    ) : (
      <EnvironmentSummary environment={value} />
    );
  }

  return (
    <Flexbox gap={24}>
      <Group title={t('settings.cloudSandboxGroup')}>{cloud}</Group>
      <Group title={t('settings.devicesGroup')}>
        <LocalDirectories
          canManage={!!canManage}
          environmentId={environment?.id}
          projectId={projectId}
        />
      </Group>
    </Flexbox>
  );
}
