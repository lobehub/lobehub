'use client';

import { Flexbox, Icon, Input, Popover, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckIcon, ChevronDownIcon, FolderIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useUpdateDeviceCwd } from './useUpdateDeviceCwd';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  dirItem: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  dirItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  dirName: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  dirPath: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scrollContainer: css`
    overflow-y: auto;
    max-height: 320px;
  `,
  sectionTitle: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

interface DeviceWorkingDirectoryProps {
  agentId: string;
}

/**
 * Working-directory picker for runs dispatched to a remote device
 * (`executionTarget='device'`). Unlike the desktop picker, the device's
 * filesystem isn't browsable from here, so the cwd comes from the device's
 * `recentCwds` (persisted via the registry) plus a manual path field. A pick is
 * pinned to the active topic (override) and persisted back to the device
 * (`defaultCwd` + `recentCwds`) so it seeds future topics and the recent list.
 */
const DeviceWorkingDirectory = memo<DeviceWorkingDirectoryProps>(({ agentId }) => {
  const { t } = useTranslation(['plugin', 'chat']);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');

  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const boundDeviceId = agencyConfig?.boundDeviceId;

  const { data: devices } = lambdaQuery.device.listDevices.useQuery(undefined, {
    staleTime: 30_000,
  });
  const device = useMemo(
    () => devices?.find((d) => d.deviceId === boundDeviceId),
    [devices, boundDeviceId],
  );
  const recentCwds = device?.recentCwds ?? [];

  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  // Mirror the server's resolution (topic override > device.defaultCwd).
  const effectiveDir = topicWorkingDirectory || device?.defaultCwd || '';

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const activeTopic = useChatStore((s) =>
    s.activeTopicId ? topicSelectors.getTopicById(s.activeTopicId)(s) : undefined,
  );
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  const updateDeviceCwd = useUpdateDeviceCwd();

  const commitDir = useCallback(
    async (path: string) => {
      const newPath = path.trim();
      if (!newPath || !boundDeviceId) return;

      const commit = async () => {
        // Pin this topic to the chosen cwd (override wins server-side), and
        // persist to the device so defaultCwd + recentCwds stay in sync.
        if (activeTopicId) await updateTopicMetadata(activeTopicId, { workingDirectory: newPath });
        await updateDeviceCwd(boundDeviceId, newPath, recentCwds);
        setInput('');
        setOpen(false);
      };

      // Changing a topic's cwd invalidates its pinned CC session (sessions are
      // keyed per-cwd), so warn before the implicit reset — same as the local picker.
      const priorSessionId = activeTopic?.metadata?.heteroSessionId;
      const priorCwd = activeTopic?.metadata?.workingDirectory;
      if (priorSessionId && priorCwd && priorCwd !== newPath) {
        confirmModal({
          cancelText: t('heteroAgent.switchCwd.cancel', { ns: 'chat' }),
          content: t('heteroAgent.switchCwd.content', { ns: 'chat' }),
          okText: t('heteroAgent.switchCwd.ok', { ns: 'chat' }),
          onOk: commit,
          title: t('heteroAgent.switchCwd.title', { ns: 'chat' }),
        });
        return;
      }

      await commit();
    },
    [
      activeTopicId,
      activeTopic,
      boundDeviceId,
      recentCwds,
      t,
      updateDeviceCwd,
      updateTopicMetadata,
    ],
  );

  const content = (
    <Flexbox gap={4} style={{ minWidth: 280 }}>
      <div className={styles.sectionTitle}>{t('localSystem.workingDirectory.recent')}</div>
      <div className={styles.scrollContainer}>
        {recentCwds.length === 0 ? (
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{ color: cssVar.colorTextQuaternary, fontSize: 12, padding: '12px 8px' }}
          >
            {t('localSystem.workingDirectory.noRecent')}
          </Flexbox>
        ) : (
          recentCwds.map((path) => {
            const isActive = path === effectiveDir;
            return (
              <Flexbox
                horizontal
                align={'center'}
                className={cx(styles.dirItem, isActive && styles.dirItemActive)}
                gap={8}
                key={path}
                onClick={() => void commitDir(path)}
              >
                <Icon
                  icon={FolderIcon}
                  size={16}
                  style={{ color: cssVar.colorTextTertiary, flex: 'none' }}
                />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <div className={styles.dirName}>{getDirName(path)}</div>
                  <div className={styles.dirPath}>{path}</div>
                </Flexbox>
                {isActive ? (
                  <Icon
                    icon={CheckIcon}
                    size={16}
                    style={{ color: cssVar.colorSuccess, flex: 'none' }}
                  />
                ) : null}
              </Flexbox>
            );
          })
        )}
      </div>
      <Input
        placeholder={t('localSystem.workingDirectory.placeholder')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onPressEnter={() => void commitDir(input)}
      />
    </Flexbox>
  );

  const displayName = effectiveDir
    ? getDirName(effectiveDir)
    : t('localSystem.workingDirectory.notSet');

  const trigger = (
    <div className={styles.button}>
      <Icon icon={FolderIcon} size={14} />
      <span>{displayName}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  return (
    <Popover
      content={content}
      open={open}
      placement="bottomLeft"
      styles={{ content: { padding: 4 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <div>
        {open ? (
          trigger
        ) : (
          <Tooltip title={effectiveDir || t('localSystem.workingDirectory.notSet')}>
            {trigger}
          </Tooltip>
        )}
      </div>
    </Popover>
  );
});

DeviceWorkingDirectory.displayName = 'DeviceWorkingDirectory';

export default DeviceWorkingDirectory;
