import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App, Upload } from 'antd';
import { css, cx } from 'antd-style';
import { Archive, Hash, Import, LucideCheck, Trash } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

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

export const useTopicActionsDropdownMenu = (
  options: UseTopicActionsDropdownMenuOptions = {},
): MenuProps['items'] => {
  const { t } = useTranslation(['topic', 'common']);
  const { message, modal } = App.useApp();
  const { onUploadClose } = options;
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditTopic } = usePermission('edit_own_content');

  const topics = useChatStore(topicSelectors.currentTopics);
  const [removeUnstarredTopic, removeAllTopic, importTopic, updateTopicStatus, refreshTopic] =
    useChatStore((s) => [
      s.removeUnstarredTopic,
      s.removeSessionTopics,
      s.importTopic,
      s.updateTopicStatus,
      s.refreshTopic,
    ]);

  const handleArchiveMergedPullRequests = useCallback(async () => {
    const mergedTopics = (topics ?? []).filter((topic) => {
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
      message.info(t('actions.archiveMergedPullRequestsNone'));
      return;
    }

    await Promise.all(
      mergedTopics.map(({ id }) => updateTopicStatus({ status: 'completed', topicId: id })),
    );
    await refreshTopic();
    message.success(t('actions.archiveMergedPullRequestsSuccess', { count: mergedTopics.length }));
  }, [message, refreshTopic, t, topics, updateTopicStatus]);

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

  return useMemo(() => {
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
      {
        type: 'divider' as const,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Archive} />,
        key: 'archiveMergedPullRequests',
        label: t('actions.archiveMergedPullRequests'),
        onClick: handleArchiveMergedPullRequests,
      },
      {
        disabled: !canEditTopic,
        icon: <Icon icon={Trash} />,
        key: 'deleteUnstarred',
        label: t('actions.removeUnstarred'),
        onClick: () => {
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            okButtonProps: { danger: true },
            okText: t('ok', { ns: 'common' }),
            onOk: removeUnstarredTopic,
            title: t('actions.confirmRemoveUnstarred'),
          });
        },
      },
      {
        danger: true,
        disabled: !canEditTopic,
        icon: <Icon icon={Trash} />,
        key: 'deleteAll',
        label: t('actions.removeAll'),
        onClick: () => {
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            okButtonProps: { danger: true },
            okText: t('ok', { ns: 'common' }),
            onOk: removeAllTopic,
            title: t('actions.confirmRemoveAll'),
          });
        },
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [
    topicPageSize,
    updateSystemStatus,
    handleImport,
    canCreateTopic,
    canEditTopic,
    onUploadClose,
    handleArchiveMergedPullRequests,
    removeUnstarredTopic,
    removeAllTopic,
    t,
  ]);
};
