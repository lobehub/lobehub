import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App, Upload } from 'antd';
import { css, cx } from 'antd-style';
import { Hash, Import, LucideCheck, Trash } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { TopicDisplayMode } from '@/types/topic';

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
  const { modal } = App.useApp();
  const { onUploadClose } = options;

  const [removeUnstarredTopic, removeAllTopic, importTopic] = useChatStore((s) => [
    s.removeUnstarredTopic,
    s.removeSessionTopics,
    s.importTopic,
  ]);

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

  const [topicDisplayMode, updatePreference] = useUserStore((s) => [
    preferenceSelectors.topicDisplayMode(s),
    s.updatePreference,
  ]);

  const [topicPageSize, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicPageSize(s),
    s.updateSystemStatus,
  ]);

  return useMemo(() => {
    const displayModeItems = Object.values(TopicDisplayMode).map((mode) => ({
      icon: topicDisplayMode === mode ? <Icon icon={LucideCheck} /> : <div />,
      key: mode,
      label: t(`groupMode.${mode}`),
      onClick: () => {
        updatePreference({ topicDisplayMode: mode });
      },
    }));

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
      ...displayModeItems,
      {
        type: 'divider' as const,
      },
      {
        children: pageSizeItems,
        icon: <Icon icon={Hash} />,
        key: 'displayItems',
        label: t('displayItems'),
      },
      {
        type: 'divider' as const,
      },
      {
        icon: <Icon icon={Import} />,
        key: 'import',
        label: (
          <Upload accept=".json" beforeUpload={handleImport} showUploadList={false}>
            <div className={cx(hotArea)}>{t('actions.import')}</div>
          </Upload>
        ),
        ...(onUploadClose ? { closeOnClick: false } : null),
      },
      {
        type: 'divider' as const,
      },
      {
        icon: <Icon icon={Trash} />,
        key: 'deleteUnstarred',
        label: t('actions.removeUnstarred'),
        onClick: () => {
          modal.confirm({
            cancelText: t('cancel', { ns: 'common' }),
            centered: true,
            okButtonProps: { danger: true },
            okText: t('ok', { ns: 'common' }),
            onOk: removeUnstarredTopic,
            title: t('actions.confirmRemoveUnstarred'),
          });
        },
      },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'deleteAll',
        label: t('actions.removeAll'),
        onClick: () => {
          modal.confirm({
            cancelText: t('cancel', { ns: 'common' }),
            centered: true,
            okButtonProps: { danger: true },
            okText: t('ok', { ns: 'common' }),
            onOk: removeAllTopic,
            title: t('actions.confirmRemoveAll'),
          });
        },
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [
    topicDisplayMode,
    topicPageSize,
    updatePreference,
    updateSystemStatus,
    handleImport,
    onUploadClose,
    removeUnstarredTopic,
    removeAllTopic,
    t,
    modal,
  ]);
};
