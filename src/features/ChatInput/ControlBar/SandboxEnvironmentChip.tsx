'use client';

import { Icon, Popover, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, CircleOffIcon, ContainerIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import RepositoryAvatar from '@/components/RepositoryAvatar';
import { openCreateEnvironmentModal } from '@/features/EnvironmentManager/CreateEnvironmentModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import {
  environmentChipState,
  environmentSettingsPath,
  repositorySlug,
  selectionWithEnvironment,
} from './sandboxEnvironmentOptions';
import SandboxRepositoryMenu, { type SandboxRepositoryOption } from './SandboxRepositoryMenu';
import { useSandboxEnvironmentList } from './useSandboxEnvironmentList';
import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

interface SandboxEnvironmentChipProps {
  onChange: (selection: SandboxSelection) => Promise<void>;
  /** Whether the conversation keeps its files on the drive (and the plan has one). */
  onDrive: boolean;
  /**
   * The project this conversation belongs to. It runs in the project's own
   * environment, so that is the only one offered, and managed on the
   * project's settings rather than in the workspace's list.
   */
  projectId?: string;
  /** Whether the conversation's agent is workspace-public; it applies published environments only. */
  sharedAgent?: boolean;
  /** Where this conversation works today. */
  value: SandboxSelection;
}

/**
 * The environment a cloud-sandbox run is set up from — repositories cloned,
 * setup run, variables set before the first command — or none. Independent of
 * the drive chip beside it: a temporary sandbox and a folder on the drive can
 * both be set up from one.
 *
 * On the drive, picking an environment moves the conversation into a folder of
 * its own, named after it: the setup only runs in an empty folder, and one the
 * person already works in would silently skip it.
 */
const SandboxEnvironmentChip = memo<SandboxEnvironmentChipProps>(
  ({ onChange, onDrive, projectId, sharedAgent = false, value }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const workspaceId = useActiveWorkspaceId();
    const navigate = useWorkspaceAwareNavigate();

    const {
      environments,
      failed,
      loaded,
      refresh: refreshEnvironments,
    } = useSandboxEnvironmentList({ projectId, sharedAgent, workspaceId });
    const current = environments.find((item) => item.id === value.environmentId);
    // Picked once but no longer readable — deleted, or unpublished by its owner
    // — is said rather than hidden; a list that has not loaded says nothing.
    const state = environmentChipState({
      current,
      environmentId: value.environmentId,
      failed,
      loaded,
    });

    // The drive state the pick is made against: an entitlement lost since the
    // folder was picked leaves the conversation where it was, off the drive.
    const base: SandboxSelection =
      onDrive || !isPersistentSelection(value) ? value : { environmentId: value.environmentId };

    const pick = async (environment?: SandboxRepositoryOption) => {
      try {
        await onChange(selectionWithEnvironment(base, environment));
      } catch {
        // The topic kept its place; said rather than left looking changed.
        toast.error(t('sandboxEnvironment.saveFailed'));
      }
    };

    const addEnvironment = () => {
      setOpen(false);
      openCreateEnvironmentModal(
        // A workspace-public agent applies published environments only.
        sharedAgent ? 'public' : undefined,
        async (created) => {
          await refreshEnvironments();
          if (created?.id) await pick(created);
        },
        t('sandboxEnvironment.add'),
      );
    };

    const slug = current && repositorySlug(current);
    const chipIcon = slug ? (
      <RepositoryAvatar size={14} url={slug} />
    ) : (
      <Icon icon={value.environmentId ? ContainerIcon : CircleOffIcon} size={14} />
    );
    const chipLabel =
      state.kind === 'picked'
        ? state.name
        : state.kind === 'none'
          ? t('sandboxEnvironment.none')
          : state.kind === 'missing'
            ? t('sandboxEnvironment.missing')
            : state.kind === 'loadFailed'
              ? t('sandboxEnvironment.loadFailed')
              : t('sandboxEnvironment.loading');

    const content = (
      <SandboxRepositoryMenu
        environments={environments}
        failed={failed}
        footnote={onDrive ? t('sandboxEnvironment.driveHint') : undefined}
        loaded={loaded}
        none={{ active: !value.environmentId, onPick: () => void pick() }}
        selectedId={value.environmentId}
        // A project has exactly one environment, edited on its settings: there
        // is no second one to add from here.
        onAdd={projectId ? undefined : addEnvironment}
        onClose={() => setOpen(false)}
        onPick={pick}
        onRetry={() => void refreshEnvironments()}
        onManage={() => {
          setOpen(false);
          navigate(environmentSettingsPath(projectId));
        }}
      />
    );

    return (
      <Popover
        arrow={false}
        content={content}
        open={open}
        placement={'topLeft'}
        styles={{ content: { padding: 4 } }}
        trigger={'click'}
        onOpenChange={setOpen}
      >
        <div>
          <div
            data-testid={'sandbox-environment-chip'}
            {...stylex.props(workingDirectoryChipStyles.chip)}
          >
            {chipIcon}
            <span {...stylex.props(workingDirectoryChipStyles.label)}>{chipLabel}</span>
            <Icon icon={ChevronDownIcon} size={12} />
          </div>
        </div>
      </Popover>
    );
  },
);

SandboxEnvironmentChip.displayName = 'SandboxEnvironmentChip';

export default SandboxEnvironmentChip;
