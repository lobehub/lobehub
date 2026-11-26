'use client';

import type { DeviceExecutionTarget } from '@lobechat/types';
import { Flexbox, Icon, Popover, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, FolderIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RepositoryAvatar from '@/components/RepositoryAvatar';
import OptionRow from '@/features/ChatInput/ControlBar/OptionRow';
import {
  repositoriesLabel,
  repositorySlug,
} from '@/features/ChatInput/ControlBar/sandboxEnvironmentOptions';
import { workingDirectoryChipStyles } from '@/features/ChatInput/ControlBar/workingDirectoryChipStyles';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { environmentRepositoryUrl } from '../environmentSource';
import { openAddDirectoryModal } from '../WorkingDirectories/AddDirectoryModal';
import { addedFolderTarget } from './useProjectDirectory';
import { NO_ENVIRONMENT, type useProjectRepository } from './useProjectRepository';
import type { useProjectWorkLocation } from './useProjectWorkLocation';

/**
 * A submenu's list can arrive after it opens; sized to itself, its positioner
 * would keep the size it was first measured at.
 */
const SUBMENU_STYLES = {
  content: { padding: 4 },
  root: { height: 'auto', width: 'auto' },
};

const styles = stylex.create({
  // Body size and color: the tray says where the work happens, not a footnote.
  button: {
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
  },
  /** Shown, not picked: no hover, since nothing opens. */
  static: {
    cursor: 'default',
    backgroundColor: { 'default': 'transparent', ':hover': 'transparent' },
  },
  warning: {
    color: cssVar.colorWarning,
  },
  header: {
    paddingBlock: '4px',
    paddingInline: '8px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  hint: {
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  list: {
    overflowY: 'auto',
    maxHeight: '280px',
  },
});

interface ProjectWorkLocationPickerProps {
  /** Whether this member may give the project another environment. */
  canManage: boolean;
  /** Icon only, the place in the tooltip — for a narrow composer. */
  compact?: boolean;
  /** The project folder a run on a device starts in. */
  directoryState: {
    directory?: ProjectDirectory;
    directoriesOn: (deviceId: string) => ProjectDirectory[];
    setPickedId: (directoryId: string) => void;
  };
  disabled?: boolean;
  /** Where the agent runs and where it can be moved to. */
  location: ReturnType<typeof useProjectWorkLocation>;
  projectId: string;
  /** A task starts no conversation, so it has no code environment or folder to pick. */
  showRepositories?: boolean;
  state: Pick<
    ReturnType<typeof useProjectRepository>,
    'repositories' | 'repository' | 'withoutEnvironment'
  > & { setPickedId: (environmentId: string) => void };
}

/**
 * Where a new project conversation works, in one place: the cloud sandbox —
 * in which of the project's code environments — or one of the agent's devices.
 * The target is the agent's, written the way the conversation's own device
 * picker writes it; the code environment is this conversation's.
 */
const ProjectWorkLocationPicker = ({
  canManage,
  compact,
  directoryState,
  disabled,
  location,
  projectId,
  showRepositories = true,
  state,
}: ProjectWorkLocationPickerProps) => {
  const { t } = useTranslation('project');
  const { t: tChat } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const [open, setOpen] = useState(false);
  const {
    boundDevice,
    deviceRows,
    displayed,
    localAvailable,
    currentDeviceId,
    sandboxAvailable,
    select: moveTo,
    switchable,
    target,
  } = location;
  const onSandbox = target === 'sandbox';

  const { repositories, repository, setPickedId, withoutEnvironment } = state;
  const repositoryShown = showRepositories && onSandbox && !!repository;
  // The chip sits at the composer's right edge, so the second level opens inward.
  const submenuPlacement = 'leftTop';

  const select = async (next: DeviceExecutionTarget, deviceId?: string) => {
    setOpen(false);
    if (!(await moveTo(next, deviceId))) toast.error(t('overview.context.target.switchFailed'));
  };

  const pickRepository = (environmentId: string) => {
    setPickedId(environmentId);
    if (!onSandbox) void select('sandbox');
    else setOpen(false);
  };

  const { directory, directoriesOn, setPickedId: setDirectoryId } = directoryState;
  const directoryShown = showRepositories && !onSandbox && !!directory;

  /** A folder belongs to one machine; picking it moves the run there too. */
  const pickDirectory = (directoryId: string, next: 'device' | 'local', deviceId?: string) => {
    setDirectoryId(directoryId);
    void select(next, deviceId);
  };

  const addDirectory = (next: 'device' | 'local', deviceId?: string) => {
    setOpen(false);
    openAddDirectoryModal(projectId, undefined, {
      deviceId: next === 'local' ? currentDeviceId : deviceId,
      // Follow the folder to the machine it was saved on, which the dialog lets
      // the person change: this desktop runs it locally, any other as a device.
      onAdded: (added) => {
        const place = addedFolderTarget(added, next, currentDeviceId);
        pickDirectory(added.id, place.target, place.deviceId);
      },
    });
  };

  // A project has one environment; its repositories are edited on the
  // project's settings, not picked or added here.
  const configureEnvironment = () => {
    setOpen(false);
    navigate(`/project/${projectId}/settings/environments`);
  };

  // What the chip says: the code environment when the run checks one out,
  // otherwise the place itself.
  let chipIcon: ReactNode = <ExecutionTargetIcon target={target} />;
  let chipLabel: string =
    target === 'device'
      ? (boundDevice?.friendlyName ?? boundDevice?.hostname ?? t('overview.context.target.device'))
      : tChat(`heteroAgent.executionTarget.${target}`);
  if (repositoryShown) {
    const slug = repositorySlug(repository) ?? repository.name;
    chipIcon = <RepositoryAvatar size={16} url={environmentRepositoryUrl(repository)} />;
    chipLabel = slug.split('/').pop() || repository.name;
  } else if (target === 'device') {
    chipIcon = <ExecutionTargetIcon devicePlatform={boundDevice?.platform} target={'device'} />;
  }
  // On a machine, the folder is what the conversation works in.
  const machineLabel = chipLabel;
  if (directoryShown) chipLabel = directory.name;

  const hint = onSandbox
    ? repositoryShown
      ? `${repositoriesLabel(repository) ?? repository.name} · ${tChat('heteroAgent.executionTarget.sandbox')}`
      : t('overview.context.target.sandboxTooltip')
    : target === 'none'
      ? t('overview.context.target.noneTooltip')
      : directoryShown
        ? `${directory.path} · ${machineLabel}`
        : showRepositories && (target === 'device' || target === 'local')
          ? t('overview.context.location.noDirectoryTooltip')
          : undefined;
  const tooltip = compact ? [chipLabel, hint].filter(Boolean).join(' · ') : hint;

  // Nothing to pick: a read-only target with no code environment to choose.
  // A fixed target still leaves the folder on its machine to choose.
  const machineFolders = directoriesOn(location.machineDeviceId ?? '');
  const interactive =
    !disabled &&
    (switchable ||
      (showRepositories && onSandbox && (repositories.length > 1 || canManage)) ||
      (showRepositories &&
        !onSandbox &&
        !!location.machineDeviceId &&
        (machineFolders.length > 1 || canManage)));

  // An execution environment is one thing to pick: a cloud sandbox set up
  // from the project's environment (its repositories, setup and variables),
  // an empty one — or, below, a device with its local folder.
  const sandboxEntities = (
    <>
      <div {...stylex.props(styles.header)}>{t('overview.context.location.sandboxes')}</div>
      <div {...stylex.props(styles.list)}>
        {repositories.map((environment) => (
          <OptionRow
            compact
            active={onSandbox && environment.id === repository?.id}
            desc={repositoriesLabel(environment) ?? undefined}
            icon={<RepositoryAvatar size={16} url={environmentRepositoryUrl(environment)} />}
            key={environment.id}
            label={environment.name}
            onClick={() => pickRepository(environment.id)}
          />
        ))}
        {/* Not every conversation needs the checkout: an empty sandbox starts
            in an empty working directory. */}
        <OptionRow
          compact
          active={onSandbox && (withoutEnvironment || repositories.length === 0)}
          desc={t('overview.context.location.emptySandboxDesc')}
          icon={<ExecutionTargetIcon target={'sandbox'} />}
          label={t('overview.context.location.emptySandbox')}
          onClick={() =>
            repositories.length > 0
              ? pickRepository(NO_ENVIRONMENT)
              : switchable
                ? void select('sandbox')
                : setOpen(false)
          }
        />
      </div>
      {canManage && (
        <OptionRow
          compact
          icon={<Icon icon={SettingsIcon} size={16} />}
          label={t('environment.configure')}
          onClick={configureEnvironment}
        />
      )}
    </>
  );

  /** One machine's folders: the second level of its row. */
  const directoryMenu = (next: 'device' | 'local', deviceId?: string) => {
    const folders = directoriesOn((next === 'local' ? currentDeviceId : deviceId) ?? '');
    const onThisMachine =
      next === 'local'
        ? target === 'local'
        : target === 'device' && deviceId === boundDevice?.deviceId;
    return (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 260 }}>
        <div {...stylex.props(styles.header)}>{t('overview.context.location.directories')}</div>
        <div {...stylex.props(styles.list)}>
          {folders.map((folder) => (
            <OptionRow
              compact
              active={onThisMachine && folder.id === directory?.id}
              // A path is long: on its own line, so the folder's name stays whole.
              desc={folder.path}
              icon={<Icon icon={FolderIcon} size={16} />}
              key={folder.id}
              label={folder.name}
              onClick={() => pickDirectory(folder.id, next, deviceId)}
            />
          ))}
        </div>
        {folders.length === 0 && (
          <Text className={stylex.props(styles.hint).className}>
            {t('overview.context.location.noDirectories')}
          </Text>
        )}
        {canManage && (
          <OptionRow
            compact
            icon={<Icon icon={PlusIcon} size={16} />}
            label={t('settings.addDirectory')}
            onClick={() => addDirectory(next, deviceId)}
          />
        )}
      </Flexbox>
    );
  };

  /** A machine row opens its folders one level down, as the sandbox opens its repositories. */
  const machineRow = (row: ReactNode, next: 'device' | 'local', deviceId?: string) =>
    showRepositories ? (
      <Popover
        arrow={false}
        closeDelay={150}
        content={directoryMenu(next, deviceId)}
        key={deviceId ?? next}
        placement={submenuPlacement}
        styles={SUBMENU_STYLES}
        trigger={['hover', 'click']}
      >
        <div data-testid={`project-location-machine-${deviceId ?? next}`}>{row}</div>
      </Popover>
    ) : (
      row
    );

  const sandboxRow = (
    <OptionRow
      active={onSandbox}
      disabled={!switchable && !onSandbox}
      icon={<ExecutionTargetIcon target={'sandbox'} />}
      label={tChat('heteroAgent.executionTarget.sandbox')}
      onClick={() => {
        if (switchable) void select('sandbox');
        else setOpen(false);
      }}
    />
  );

  /** A machine as places to run: one row per local folder, or the machine itself without one. */
  const machineEntities = (next: 'device' | 'local', device?: (typeof deviceRows)[number]) => {
    const deviceId = device?.deviceId;
    const folders = showRepositories
      ? directoriesOn((next === 'local' ? currentDeviceId : deviceId) ?? '')
      : [];
    const onThisMachine =
      next === 'local'
        ? target === 'local'
        : target === 'device' && deviceId === boundDevice?.deviceId;
    const name =
      next === 'local'
        ? tChat('heteroAgent.executionTarget.local')
        : device?.friendlyName || device?.hostname || deviceId || '';
    const icon =
      next === 'local' ? (
        <ExecutionTargetIcon target={'local'} />
      ) : (
        <ExecutionTargetIcon devicePlatform={device?.platform} target={'device'} />
      );
    const status = device && (
      <ExecutionTargetDeviceStatus
        offlineLabel={tChat('heteroAgent.executionTarget.offline')}
        online={device.online}
        onlineLabel={tChat('heteroAgent.executionTarget.online')}
        unknown={device.onlineUnknown}
        unknownLabel={tChat('heteroAgent.executionTarget.presenceChecking')}
      />
    );
    if (folders.length > 0)
      return folders.map((folder) => (
        <OptionRow
          active={onThisMachine && folder.id === directory?.id}
          // The path on its own line, so the machine's name stays whole.
          desc={folder.path}
          hint={status}
          icon={icon}
          key={folder.id}
          label={name}
          onClick={() => pickDirectory(folder.id, next, deviceId)}
        />
      ));
    return machineRow(
      <OptionRow
        active={onThisMachine}
        arrow={showRepositories}
        hint={status}
        icon={icon}
        label={name}
        onClick={() => void select(next, deviceId)}
      />,
      next,
      deviceId,
    );
  };

  const content = (
    <Flexbox gap={2} style={{ maxWidth: 380, minWidth: 300 }}>
      <div {...stylex.props(styles.header)}>{t('overview.context.location.title')}</div>
      {(sandboxAvailable || onSandbox) &&
        (showRepositories ? (
          sandboxEntities
        ) : (
          <div data-testid={'project-location-sandbox'}>{sandboxRow}</div>
        ))}
      {(localAvailable || deviceRows.length > 0) && (
        <>
          <div {...stylex.props(styles.header)}>{t('overview.context.location.devices')}</div>
          <div {...stylex.props(styles.list)}>
            {localAvailable && machineEntities('local')}
            {deviceRows.map((device) => (
              <Fragment key={device.deviceId}>{machineEntities('device', device)}</Fragment>
            ))}
          </div>
          {showRepositories && canManage && (
            <OptionRow
              compact
              icon={<Icon icon={PlusIcon} size={16} />}
              label={t('settings.addDirectory')}
              onClick={() => addDirectory('device')}
            />
          )}
        </>
      )}
    </Flexbox>
  );

  if (!displayed && !repositoryShown) return null;

  const chip = (
    <button
      aria-label={chipLabel}
      data-testid={'project-location-chip'}
      disabled={!interactive}
      type={'button'}
      {...stylex.props(
        workingDirectoryChipStyles.chip,
        styles.button,
        !interactive && styles.static,
        target === 'none' && styles.warning,
      )}
    >
      {chipIcon}
      {!compact && <span {...stylex.props(workingDirectoryChipStyles.label)}>{chipLabel}</span>}
      {interactive && <Icon icon={ChevronDownIcon} size={12} />}
    </button>
  );

  if (!interactive)
    return (
      <Tooltip title={tooltip}>
        <div>{chip}</div>
      </Tooltip>
    );

  // A plain div between the popover and the chip: the popover merges trigger
  // props into its direct child.
  return (
    <Popover
      arrow={false}
      content={content}
      open={open}
      placement={'bottomRight'}
      styles={{ content: { padding: 4 } }}
      trigger={'click'}
      onOpenChange={setOpen}
    >
      <div>
        <Tooltip title={open ? undefined : tooltip}>
          <div>{chip}</div>
        </Tooltip>
      </div>
    </Popover>
  );
};

export default ProjectWorkLocationPicker;
