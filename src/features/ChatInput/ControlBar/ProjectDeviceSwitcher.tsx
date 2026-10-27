'use client';

import { createStaticStyles, cssVar, Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import DeviceLoadMeter, { useDeviceLoad } from '@/features/DeviceManager/DeviceLoadMeter';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
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

const styles = createStaticStyles(({ css }) => ({
  // Picking a device here really picks an environment, and the path is what
  // tells them apart, so it wraps in full instead of truncating.
  desc: css`
    min-width: 0;
    overflow-wrap: anywhere;
  `,
  hint: css`
    padding-block: 6px;
    padding-inline: 8px;
    font-size: 11px;
    color: ${cssVar.colorTextDescription};
  `,
  status: css`
    flex: none;
    white-space: nowrap;
  `,
  title: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface ProjectDeviceSwitcherProps {
  /** Tag on the current directory's row, naming what runs there. */
  activeTag?: string;
  agentId: string;
  directories: ProjectDirectory[];
  directoryId?: string;
  /** Picked another device's project directory. */
  onSelect: (target: ProjectDeviceTarget) => void;
}

/**
 * Device switcher for a conversation that runs in a project directory.
 *
 * The directory belongs to the project, so the only choice left is which
 * device to run on — and each device brings the project's own directory there.
 * Only devices the project has a directory on are offered; picking one moves
 * the conversation to that directory rather than to an arbitrary path. The
 * directory itself has no chip of its own; its path rides on this trigger's
 * tooltip.
 */
const ProjectDeviceSwitcher = ({
  activeTag,
  agentId,
  directories,
  directoryId,
  onSelect,
}: ProjectDeviceSwitcherProps) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const { canUseResource } = useChatInputResourceAccess();
  const directory = directories.find((d) => d.id === directoryId);
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

  const handleSelect = (target: ProjectDeviceTarget) => {
    setOpen(false);
    if (!target.active) onSelect(target);
  };

  const content = (
    <Flexbox style={{ maxWidth: 400, minWidth: 280 }}>
      <div className={styles.title}>{t('heteroAgent.executionTarget.title')}</div>
      {targets.map((target) => {
        const selectable = target.online && target.allowed;
        const row = (
          <OptionRow
            active={target.active}
            disabled={!selectable}
            key={target.directory.id}
            label={target.label}
            tags={target.active && activeTag ? [activeTag] : []}
            desc={
              target.allowed ? (
                <>
                  <span className={styles.desc}>{target.directory.path}</span>
                  <span className={styles.status}>
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
                <span className={styles.desc}>{t('heteroAgent.executionTarget.fixedTip')}</span>
              )
            }
            icon={
              <ExecutionTargetIcon devicePlatform={target.directory.platform} target={'device'} />
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
      })}
      <div className={styles.hint}>{t('heteroAgent.executionTarget.projectDevicesHint')}</div>
    </Flexbox>
  );

  const trigger = (
    <div className={workingDirectoryChipStyles.chip}>
      <ExecutionTargetIcon devicePlatform={directory?.platform} target={'device'} />
      <span className={workingDirectoryChipStyles.label}>
        {directory
          ? projectDirectoryDeviceName(directory, devices)
          : t('heteroAgent.executionTarget.unknownDevice')}
      </span>
      {load && <DeviceLoadMeter load={load} />}
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  // The tooltip's body lays its children out in a row; stack the two lines.
  const tooltip = directory ? (
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
