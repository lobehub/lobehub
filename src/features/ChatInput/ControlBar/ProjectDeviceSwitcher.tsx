'use client';

import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import DeviceLoadMeter, { useDeviceLoad } from '@/features/DeviceManager/DeviceLoadMeter';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
import { getProjectSettingsPath } from '@/features/Projects/Layout/navigation';
import { useProjectExecutionEnvironments } from '@/features/Projects/WorkingDirectories/useProjectExecutionEnvironments';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useDeviceList } from '@/store/device';
import { type ProjectDirectory } from '@/store/projectWorkingDirectory';

import DeviceDetailPopover from './DeviceDetailPopover';
import OptionRow from './OptionRow';
import {
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
  directories: ProjectDirectory[];
  directoryId?: string;
  /** Picked another device's project directory; absent when folders can't be picked here. */
  onSelect?: (target: ProjectDeviceTarget) => void;
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
  directories,
  directoryId,
  onSelect,
  projectId: projectIdProp,
  sandbox,
}: ProjectDeviceSwitcherProps) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const [open, setOpen] = useState(false);
  const { canUseResource } = useChatInputResourceAccess();
  const directory = directories.find((d) => d.id === directoryId);
  const projectId = projectIdProp ?? directories[0]?.projectId;
  const { ordered } = useProjectExecutionEnvironments(projectId, !!projectId);
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

  const handleSelect = (target: ProjectDeviceTarget) => {
    setOpen(false);
    if (!target.active) onSelect?.(target);
  };

  const sandboxRow = sandbox ? (
    <OptionRow
      active={sandbox.active}
      disabled={!sandbox.onSelect}
      icon={<ExecutionTargetIcon target={'sandbox'} />}
      key="sandbox"
      label={t('heteroAgent.executionTarget.sandbox')}
      tags={sandbox.active && activeTag ? [activeTag] : []}
      onClick={() => {
        if (!sandbox.onSelect || sandbox.active) return;
        setOpen(false);
        sandbox.onSelect();
      }}
    />
  ) : null;

  const renderTarget = (target: ProjectDeviceTarget) => {
    const selectable = !!onSelect && target.online && target.allowed;
    const row = (
      <OptionRow
        active={target.active}
        disabled={!selectable}
        icon={<ExecutionTargetIcon devicePlatform={target.directory.platform} target={'device'} />}
        key={target.directory.id}
        label={target.label}
        tags={target.active && activeTag ? [activeTag] : []}
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
        <span {...stylex.props(styles.title)}>{t('heteroAgent.executionTarget.title')}</span>
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
      {rows.map((item) => {
        if (item.kind === 'sandbox') return sandboxRow;
        const target = targetById.get(item.id);
        return target ? renderTarget(target) : null;
      })}
    </Flexbox>
  );

  const onSandbox = !!sandbox?.active;
  const trigger = (
    <div {...stylex.props(workingDirectoryChipStyles.chip)}>
      <ExecutionTargetIcon
        devicePlatform={onSandbox ? undefined : directory?.platform}
        target={onSandbox ? 'sandbox' : 'device'}
      />
      <span {...stylex.props(workingDirectoryChipStyles.label)}>
        {onSandbox
          ? t('heteroAgent.executionTarget.sandbox')
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
      placement="topLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div>{open || !tooltip ? trigger : <Tooltip title={tooltip}>{trigger}</Tooltip>}</div>
    </Popover>
  );
};

export default ProjectDeviceSwitcher;
