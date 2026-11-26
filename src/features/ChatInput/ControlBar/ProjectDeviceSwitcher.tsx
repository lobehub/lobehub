'use client';

import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, PlusIcon, SettingsIcon, SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import DeviceLoadMeter, { useDeviceLoad } from '@/features/DeviceManager/DeviceLoadMeter';
import { isCurrentMachineDevice, useCurrentMachine } from '@/features/DeviceManager/devicePicker';
import { OfflineDevicesToggle } from '@/features/DeviceManager/OfflineDevicesToggle';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
import { getProjectSettingsPath } from '@/features/Projects/Layout/navigation';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import { openAddDirectoryModal } from '@/features/Projects/WorkingDirectories/AddDirectoryModal';
import { useProjectExecutionEnvironments } from '@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useDeviceList } from '@/store/device';
import {
  type ProjectDirectory,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';

import DeviceDetailPopover from './DeviceDetailPopover';
import OptionRow from './OptionRow';
import {
  isProjectSandboxRowDisabled,
  listProjectDeviceTargets,
  type ProjectDeviceTarget,
  projectDirectoryDeviceName,
} from './projectDeviceTargets';
import { workingDirectoryChipStyles } from './workingDirectoryChipStyles';

const styles = stylex.create({
  // Picking a device here really picks an environment, and the path is what
  // tells them apart, so it wraps in full instead of truncating.
  desc: { minWidth: '0', overflowWrap: 'anywhere' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '4px',
    paddingInline: '8px',
  },
  manage: {
    cursor: 'pointer',
    display: 'flex',
    gap: '3px',
    alignItems: 'center',
    padding: '0',
    borderStyle: 'none',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorPrimary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s',
  },
  status: { flex: 'none', whiteSpace: 'nowrap' },
  title: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
});

interface ProjectDeviceSwitcherProps {
  /** Tag on the current directory's row, naming what runs there. */
  activeTag?: string;
  agentId: string;
  /**
   * The automatic choice, offered above the runners: the conversation starts on
   * whichever runner the project's order picks — the sandbox or `directoryId`
   * as passed — and the row names it, so the person still sees where.
   */
  auto?: { active: boolean; onSelect: () => void };
  directories: ProjectDirectory[];
  directoryId?: string;
  /** Picked another device's project directory; absent when folders can't be picked here. */
  onSelect?: (target: ProjectDeviceTarget) => void;
  /** Where the menu opens; above the chip by default, as under a chat input. */
  placement?: 'bottomRight' | 'topLeft';
  /** The project whose execution environments are offered, in its priority order. */
  projectId?: string;
  /**
   * The cloud sandbox's row: whether the conversation runs there, and how to
   * move it there — absent when it can't be (a conversation already bound to
   * a folder keeps its folder).
   */
  sandbox?: { active: boolean; onSelect?: () => void };
}

/**
 * The execution-environment picker of a project conversation: only the
 * project's own execution environments — the cloud sandbox and the device
 * folders someone added — in the project's priority order, and a shortcut to
 * manage them on the project's settings.
 *
 * A folder belongs to the project, so picking a device moves the
 * conversation to that device's folder rather than to an arbitrary path. The
 * folder has no chip of its own; its path rides on this trigger's tooltip.
 */
const ProjectDeviceSwitcher = ({
  activeTag,
  agentId,
  auto,
  directories,
  directoryId,
  onSelect,
  placement = 'topLeft',
  projectId: projectIdProp,
  sandbox,
}: ProjectDeviceSwitcherProps) => {
  const { t } = useTranslation(['chat', 'device']);
  const navigate = useWorkspaceAwareNavigate();
  const [open, setOpen] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const currentMachine = useCurrentMachine();
  const { canUseResource } = useChatInputResourceAccess();
  const canManageProject = useCanManageProject();
  const directory = directories.find((d) => d.id === directoryId);
  const projectId = projectIdProp ?? directories[0]?.projectId;
  const { ordered } = useProjectExecutionEnvironments(projectId, !!projectId);
  useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId, !!projectId);
  // Without a project this would read the scope-wide list, so it is ignored.
  const [scopedEnvironment] = useProjectEnvironments(projectId);
  const projectEnvironment = projectId ? scopedEnvironment : undefined;
  const { data: devices } = useDeviceList();
  const load = useDeviceLoad(devices?.find((d) => d.deviceId === directory?.deviceId));
  // The shared row, not the topic-pinned effective config: a fixed target is
  // the author's setting, and it is what the server checks the move against.
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const fixedDeviceId =
    agencyConfig?.executionTargetSelectionPolicy === 'fixed'
      ? agencyConfig.boundDeviceId
      : undefined;

  if (!canUseResource) return null;

  const targets = listProjectDeviceTargets(directories, devices, directoryId, fixedDeviceId);
  const targetById = new Map(targets.map((target) => [target.directory.id, target]));
  // The project's order, the cloud sandbox included; a list still loading
  // keeps the folders' own order with the sandbox first.
  const rows = ordered.some((item) => item.kind === 'directory')
    ? ordered
    : [
        { id: 'sandbox', kind: 'sandbox' as const },
        ...targets.map((target) => ({ id: target.directory.id, kind: 'directory' as const })),
      ];

  const isCurrent = (target: ProjectDeviceTarget) =>
    !!target.device && isCurrentMachineDevice(target.device, currentMachine);
  // The project's order stays; offline devices fold away at the end unless one is the pick.
  const isFolded = (target: ProjectDeviceTarget) =>
    !target.online && !target.onlineUnknown && !target.active;
  const offlineTargets = targets.filter(isFolded);

  // On the automatic choice, every runner row is a pick of its own, the one
  // it resolves to included: picking it pins the conversation there.
  const autoActive = !!auto?.active;
  const handleSelect = (target: ProjectDeviceTarget) => {
    setOpen(false);
    if (!target.active || autoActive) onSelect?.(target);
  };

  // A runner like any device: the repositories belong to the project's
  // environment, which every runner prepares, so they no longer name it.
  const sandboxName = t('heteroAgent.executionTarget.sandbox');
  const sandboxRow = sandbox ? (
    <OptionRow
      active={sandbox.active && !autoActive}
      desc={t('settings.sandboxRunnerDesc', { ns: 'project' })}
      disabled={isProjectSandboxRowDisabled(sandbox)}
      icon={<ExecutionTargetIcon target={'sandbox'} />}
      key="sandbox"
      label={sandboxName}
      tags={sandbox.active && activeTag ? [activeTag] : []}
      onClick={() => {
        if (isProjectSandboxRowDisabled(sandbox)) return;
        setOpen(false);
        if (!sandbox.active || autoActive) sandbox.onSelect?.();
      }}
    />
  ) : null;

  const renderTarget = (target: ProjectDeviceTarget) => {
    const selectable = !!onSelect && target.online && target.allowed;
    const row = (
      <OptionRow
        active={target.active && !autoActive}
        disabled={!selectable}
        icon={<ExecutionTargetIcon devicePlatform={target.directory.platform} target={'device'} />}
        key={target.directory.id}
        label={target.label}
        desc={
          target.allowed ? (
            <>
              <span {...stylex.props(styles.desc)}>{target.directory.path}</span>
              <span {...stylex.props(styles.status)}>
                <ExecutionTargetDeviceStatus
                  offlineLabel={t('heteroAgent.executionTarget.offline')}
                  online={target.online}
                  onlineLabel={t('heteroAgent.executionTarget.online')}
                  unknown={target.onlineUnknown}
                  unknownLabel={t('heteroAgent.executionTarget.presenceChecking')}
                />
              </span>
            </>
          ) : (
            <span {...stylex.props(styles.desc)}>{t('heteroAgent.executionTarget.fixedTip')}</span>
          )
        }
        tags={[
          ...(isCurrent(target) ? [t('picker.thisDevice', { ns: 'device' })] : []),
          ...(target.active && activeTag ? [activeTag] : []),
        ]}
        onClick={() => (selectable ? handleSelect(target) : undefined)}
      />
    );
    // Same hover details as the regular device picker: the label alone
    // can't tell two machines' specs or last-seen time apart.
    return target.device ? (
      <DeviceDetailPopover device={target.device} key={target.directory.id}>
        <div>{row}</div>
      </DeviceDetailPopover>
    ) : (
      row
    );
  };

  const content = (
    <Flexbox style={{ maxWidth: 400, minWidth: 280 }}>
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.title)}>{t('settings.runners', { ns: 'project' })}</span>
        {projectId && (
          <button
            {...stylex.props(styles.manage)}
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(getProjectSettingsPath(projectId, 'environments'));
            }}
          >
            <Icon icon={SettingsIcon} size={11} />
            <span>{t('heteroAgent.executionTarget.manage')}</span>
          </button>
        )}
      </div>
      {auto && (
        <OptionRow
          active={auto.active}
          icon={<Icon icon={SparklesIcon} size={16} />}
          key="auto"
          label={t('runnerPicker.auto', { ns: 'project' })}
          desc={
            auto.active
              ? t('runnerPicker.autoResolved', {
                  ns: 'project',
                  runner:
                    sandbox?.active || !directory
                      ? sandboxName
                      : projectDirectoryDeviceName(directory, devices),
                })
              : t('runnerPicker.autoDesc', { ns: 'project' })
          }
          onClick={() => {
            setOpen(false);
            if (!auto.active) auto.onSelect();
          }}
        />
      )}
      {rows.map((item) => {
        if (item.kind === 'sandbox') return sandboxRow;
        const target = targetById.get(item.id);
        return target && !isFolded(target) ? renderTarget(target) : null;
      })}
      {offlineTargets.length > 0 && (
        <OfflineDevicesToggle
          count={offlineTargets.length}
          expanded={showOffline}
          onToggle={() => setShowOffline((v) => !v)}
        />
      )}
      {showOffline && offlineTargets.map(renderTarget)}
      {projectId && canManageProject && (
        <OptionRow
          compact
          icon={<Icon icon={PlusIcon} size={16} />}
          label={t('settings.addExecutionEnvironment', { ns: 'project' })}
          onClick={() => {
            setOpen(false);
            openAddDirectoryModal(projectId, projectEnvironment?.id);
          }}
        />
      )}
    </Flexbox>
  );

  const onSandbox = !!sandbox?.active;
  const trigger = (
    <div {...stylex.props(workingDirectoryChipStyles.chip)}>
      {/* On the sandbox the chip names it as the menu does: its repositories
          and the first one's logo, once it has any. */}
      {autoActive ? (
        <Icon icon={SparklesIcon} size={14} />
      ) : (
        <ExecutionTargetIcon
          devicePlatform={onSandbox ? undefined : directory?.platform}
          target={onSandbox ? 'sandbox' : 'device'}
        />
      )}
      <span {...stylex.props(workingDirectoryChipStyles.label)}>
        {autoActive
          ? t('runnerPicker.auto', { ns: 'project' })
          : onSandbox
            ? sandboxName
            : directory
              ? projectDirectoryDeviceName(directory, devices)
              : t('heteroAgent.executionTarget.unknownDevice')}
      </span>
      {load && <DeviceLoadMeter load={load} />}
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  // The tooltip's body lays its children out in a row; stack the two lines.
  const tooltip =
    directory && !onSandbox ? (
      <Flexbox gap={4}>
        <span>{t('directories.boundTip', { ns: 'project', path: directory.path })}</span>
        {load && <span>{load.summary}</span>}
      </Flexbox>
    ) : undefined;

  return (
    <Popover
      content={content}
      open={open}
      placement={placement}
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div>{open || !tooltip ? trigger : <Tooltip title={tooltip}>{trigger}</Tooltip>}</div>
    </Popover>
  );
};

export default ProjectDeviceSwitcher;
