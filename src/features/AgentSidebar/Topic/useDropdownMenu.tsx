import { isDesktop } from '@lobechat/const';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { App, Upload } from 'antd';
import { css, cx } from 'antd-style';
import { Archive, HardDriveDownload, Hash, Import, LucideCheck, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { openHeteroSessionImportModal } from '@/features/HeteroSessionImport';
import { openWorkspaceDeleteAllModal } from '@/features/WorkspaceDeleteAllModal';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, userProfileSelectors } from '@/store/user/selectors';

const hotArea = css`
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: transparent;
  }
`;

interface UseTopicActionsDropdownMenuOptions {
  onUploadClose?: () => void;
}

type TopicMaintenanceScope = 'own' | 'workspace';

export const useTopicActionsDropdownMenu = (
  options: UseTopicActionsDropdownMenuOptions = {},
): (() => MenuProps['items']) => {
  const { t } = useTranslation(['topic', 'common']);
  const { modal } = App.useApp();
  const { onUploadClose } = options;
  const activeWorkspaceId = useActiveWorkspaceId();
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditTopic } = usePermission('edit_own_content');

  const topics = useChatStore(topicSelectors.currentTopics);
  const [
    removeUnstarredTopic,
    removeAllTopic,
    importTopic,
    updateTopicStatus,
    refreshTopic,
    activeAgentId,
  ] = useChatStore((s) => [
    s.removeUnstarredTopic,
    s.removeSessionTopics,
    s.importTopic,
    s.updateTopicStatus,
    s.refreshTopic,
    s.activeAgentId,
  ]);

  const handleArchiveMergedPullRequests = useCallback(
    async (scope: TopicMaintenanceScope = 'own') => {
      const mergedTopics = (topics ?? []).filter((topic) => {
        if (
          activeWorkspaceId &&
          scope === 'own' &&
          (!currentUserId || topic.userId !== currentUserId)
        ) {
          return false;
        }

        const pullRequest = topic.metadata?.workingDirectoryConfig?.git?.github?.pullRequest;
        const isMerged = !!pullRequest?.mergedAt || pullRequest?.state?.toLowerCase() === 'merged';

        return (
          isMerged &&
          topic.status !== 'completed' &&
          topic.status !== 'archived' &&
          topic.status !== 'unread'
        );
      });

      if (mergedTopics.length === 0) {
        toast.info(t('actions.archiveMergedPullRequestsNone'));
        return;
      }

      await Promise.all(
        mergedTopics.map(({ id }) => updateTopicStatus({ status: 'completed', topicId: id })),
      );
      await refreshTopic();
      toast.success(t('actions.archiveMergedPullRequestsSuccess', { count: mergedTopics.length }));
    },
    [activeWorkspaceId, currentUserId, refreshTopic, t, topics, updateTopicStatus],
  );

  const handleImport = useCallback(
    async (file: File) => {
      onUploadClose?.();
      try {
        const text = await file.text();
        // Validate JSON format
        JSON.parse(text);
        await importTopic(text);
      } catch {
        modal.error({
          content: t('importInvalidFormat'),
          title: t('importError'),
        });
      }
      return false; // Prevent default upload behavior
    },
    [importTopic, modal, onUploadClose, t],
  );

  const [topicPageSize, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicPageSize(s),
    s.updateSystemStatus,
  ]);

  const enableHeteroSessionImport = useUserStore(labPreferSelectors.enableHeteroSessionImport);

  return useCallback((): MenuProps['items'] => {
    const pageSizeOptions = [20, 40, 60, 100];
    const pageSizeItems = pageSizeOptions.map((size) => ({
      icon: topicPageSize === size ? <Icon icon={LucideCheck} /> : <div />,
      key: `pageSize-${size}`,
      label: t('pageSizeItem', { count: size, ns: 'common' }),
      onClick: () => {
        updateSystemStatus({ topicPageSize: size });
      },
    }));

    return [
      {
        children: pageSizeItems,
        extra: topicPageSize,
        icon: <Icon icon={Hash} />,
        key: 'displayItems',
        label: t('displayItems'),
      },
      {
        type: 'divider' as const,
      },
      {
        disabled: !canCreateTopic,
        icon: <Icon icon={Import} />,
        key: 'import',
        label: (
          <Upload
            accept=".json"
            beforeUpload={handleImport}
            disabled={!canCreateTopic}
            showUploadList={false}
          >
            <div className={cx(hotArea)}>{t('actions.import')}</div>
          </Upload>
        ),
        ...(onUploadClose ? { closeOnClick: false } : null),
      },
      // local CLI transcript import needs main-process file access — desktop
      // only, behind the heteroSessionImport Labs toggle
      ...(isDesktop && enableHeteroSessionImport
        ? [
            {
              disabled: !canCreateTopic || !activeAgentId,
              icon: <Icon icon={HardDriveDownload} />,
              key: 'importHeteroSessions',
              label: t('heteroImport.entry'),
              onClick: () => {
                if (activeAgentId) openHeteroSessionImportModal({ agentId: activeAgentId });
              },
            },
          ]
        : []),
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Archive} />,
        key: 'archiveMergedPullRequests',
        label: t(
          activeWorkspaceId
            ? 'actions.archiveMergedPullRequestsOwn'
            : 'actions.archiveMergedPullRequests',
        ),
        onClick: () => handleArchiveMergedPullRequests('own'),
      },
      ...(activeWorkspaceId && isWorkspaceOwner
        ? [
            { type: 'divider' as const },
            {
              disabled: !canEditTopic,
              icon: <Icon icon={Archive} />,
              key: 'archiveMergedPullRequestsWorkspace',
              label: t('actions.archiveMergedPullRequestsWorkspace'),
              onClick: () => {
                confirmModal({
                  cancelText: t('cancel', { ns: 'common' }),
                  okText: t('ok', { ns: 'common' }),
                  onOk: () => handleArchiveMergedPullRequests('workspace'),
                  title: t('actions.confirmArchiveMergedPullRequestsWorkspace'),
                });
              },
            },
            {
              danger: true,
              disabled: !canEditTopic,
              icon: <Icon icon={Trash} />,
              key: 'deleteUnstarredWorkspace',
              label: t('actions.removeUnstarredWorkspace'),
              onClick: () => {
                openWorkspaceDeleteAllModal({
                  acknowledgeText: t('actions.confirmRemoveUnstarredWorkspaceAcknowledge'),
                  cancelText: t('cancel', { ns: 'common' }),
                  confirmText: t('actions.removeUnstarredWorkspace'),
                  description: t('actions.confirmRemoveUnstarredWorkspace'),
                  onConfirm: () => removeUnstarredTopic({ onlyOwn: false }),
                  title: t('actions.removeUnstarredWorkspace'),
                });
              },
            },
            {
              danger: true,
              disabled: !canEditTopic,
              icon: <Icon icon={Trash} />,
              key: 'deleteAllWorkspace',
              label: t('actions.removeAllWorkspace'),
              onClick: () => {
                openWorkspaceDeleteAllModal({
                  acknowledgeText: t('actions.confirmRemoveAllWorkspaceAcknowledge'),
                  cancelText: t('cancel', { ns: 'common' }),
                  confirmText: t('actions.removeAllWorkspace'),
                  description: t('actions.confirmRemoveAllWorkspace'),
                  onConfirm: () => removeAllTopic('workspace'),
                  title: t('actions.removeAllWorkspace'),
                });
              },
            },
          ]
        : []),
    ].filter(Boolean) as MenuProps['items'];
  }, [
    topicPageSize,
    updateSystemStatus,
    handleImport,
    canCreateTopic,
    canEditTopic,
    onUploadClose,
    handleArchiveMergedPullRequests,
    activeAgentId,
    enableHeteroSessionImport,
    removeUnstarredTopic,
    removeAllTopic,
    activeWorkspaceId,
    isWorkspaceOwner,
    t,
  ]);
};
