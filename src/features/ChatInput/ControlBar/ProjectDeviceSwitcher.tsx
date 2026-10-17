'use client';

import {
  confirmModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Popover,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import OptionRow from './OptionRow';
import { listProjectDeviceTargets, projectDirectoryDeviceName } from './projectDeviceTargets';
import { useProjectTopicDirectory } from './useProjectTopicDirectory';
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
  agentId: string;
  topicId: string;
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
const ProjectDeviceSwitcher = ({ agentId, topicId }: ProjectDeviceSwitcherProps) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const { canUseResource } = useChatInputResourceAccess();
  const { directories, directory, directoryId } = useProjectTopicDirectory(topicId);
  const { data: devices } = useDeviceList();
  const moveTopic = useProjectDirectoryStore((s) => s.moveTopic);
  const refreshTopic = useChatStore((s) => s.refreshTopic);
  // The shared row, not the topic-pinned effective config: a fixed target is
  // the author's setting, and it is what the server checks the move against.
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const fixedDeviceId =
    agencyConfig?.executionTargetSelectionPolicy === 'fixed'
      ? agencyConfig.boundDeviceId
      : undefined;

  if (!canUseResource) return null;

  const targets = listProjectDeviceTargets(directories, devices, directoryId, fixedDeviceId);

  const handleSelect = ({ active, directory: target, label }: (typeof targets)[number]) => {
    setOpen(false);
    if (active) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('heteroAgent.executionTarget.switchProjectTopic.content', {
        device: label,
        directory: target.name,
      }),
      okText: t('heteroAgent.executionTarget.switchTopic.ok'),
      onOk: async () => {
        try {
          await moveTopic({ directoryId: target.id, topicId });
          await refreshTopic();
        } catch (error) {
          toast.error((error as Error).message);
        }
      },
      title: t('heteroAgent.executionTarget.switchTopic.title'),
    });
  };

  const content = (
    <Flexbox style={{ maxWidth: 400, minWidth: 280 }}>
      <div className={styles.title}>{t('heteroAgent.executionTarget.title')}</div>
      {targets.map((target) => {
        const selectable = target.online && target.allowed;
        return (
          <OptionRow
            active={target.active}
            disabled={!selectable}
            key={target.directory.id}
            label={target.label}
            tags={target.active ? [t('heteroAgent.executionTarget.topicTag')] : []}
            desc={
              target.allowed ? (
                <>
                  <span className={styles.desc}>{target.directory.path}</span>
                  <span className={styles.status}>
                    <ExecutionTargetDeviceStatus
                      offlineLabel={t('heteroAgent.executionTarget.offline')}
                      online={target.online}
                      onlineLabel={t('heteroAgent.executionTarget.online')}
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
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  return (
    <Popover
      content={content}
      open={open}
      placement="topLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div>
        {open || !directory ? (
          trigger
        ) : (
          <Tooltip title={t('directories.boundTip', { ns: 'project', path: directory.path })}>
            {trigger}
          </Tooltip>
        )}
      </div>
    </Popover>
  );
};

export default ProjectDeviceSwitcher;
