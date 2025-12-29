import { Button, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import { BrainIcon, LucideRefreshCcwDot, PlusIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { useAiInfraStore } from '@/store/aiInfra';
import { ModelUpdateResult } from '@/store/aiInfra/slices/aiModel/types';

import CreateNewModelModal from './CreateNewModelModal';
import { UpdateNotificationContent } from './UpdateNotification';

const useStyles = createStyles(({ css, token }) => ({
  circle: css`
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: ${token.colorFillSecondary};
  `,
  container: css`
    width: 100%;
    border: 1px dashed ${token.colorBorder};
    border-radius: 12px;
    background: ${token.colorBgContainer};
  `,
  description: css`
    max-width: 280px;

    font-size: ${token.fontSize}px;
    color: ${token.colorTextDescription};
    text-align: center;
    text-wrap: balance;
  `,
  iconWrapper: css`
    position: relative;
    width: 64px;
    height: 64px;
  `,
  sparklesIcon: css`
    font-size: 40px;
    color: ${token.colorText};
  `,
  title: css`
    font-size: ${token.fontSizeLG}px;
    font-weight: 500;
  `,
}));

const EmptyState = memo<{ provider: string }>(({ provider }) => {
  const { t } = useTranslation('modelProvider');
  const { styles } = useStyles();
  const { notification } = App.useApp();

  const [fetchRemoteModelList] = useAiInfraStore((s) => [s.fetchRemoteModelList]);

  const [fetchRemoteModelsLoading, setFetchRemoteModelsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const showUpdateNotification = useCallback(
    (result: ModelUpdateResult) => {
      const { added, builtinNotInRemote } = result;

      // For first fetch (empty state), show if models were added or builtin not in remote
      const hasChanges = added.length > 0 || (builtinNotInRemote && builtinNotInRemote.length > 0);
      if (hasChanges) {
        const notificationKey = `model-update-${Date.now()}`;
        let dismissed = false;
        const closeNotification = () => {
          if (dismissed) return;
          dismissed = true;
          notification.destroy(notificationKey);
        };

        // Use warning notification for outdated (builtinNotInRemote), success for updates
        const isOutdated = builtinNotInRemote && builtinNotInRemote.length > 0;
        const notificationMethod = isOutdated ? notification.warning : notification.success;

        notificationMethod({
          description: (
            <UpdateNotificationContent
              added={added}
              builtinNotInRemote={builtinNotInRemote}
              onAutoClose={closeNotification}
            />
          ),
          duration: null,
          key: notificationKey,
          message: isOutdated
            ? t('providerModels.list.fetcher.updateResult.removedButBuiltinTitle')
            : t('providerModels.list.fetcher.updateResult.title'),
          onClose: () => {
            dismissed = true;
          },
          style: { overflow: 'hidden', position: 'relative', width: 380 },
        });
      }
    },
    [notification, t],
  );

  return (
    <Center className={styles.container} gap={24} paddingBlock={40}>
      <Center className={styles.circle}>
        <Icon className={styles.sparklesIcon} icon={BrainIcon} />
      </Center>
      <Flexbox align={'center'} gap={8}>
        <div className={styles.title}>{t('providerModels.list.empty.title')}</div>
        <div className={styles.description}>{t('providerModels.list.empty.desc')}</div>
      </Flexbox>

      <Flexbox gap={8} horizontal>
        <Button
          icon={PlusIcon}
          onClick={() => {
            setShowModal(true);
          }}
        >
          {t('providerModels.list.addNew')}
        </Button>
        <CreateNewModelModal open={showModal} setOpen={setShowModal} />
        <Button
          icon={<Icon icon={LucideRefreshCcwDot} />}
          loading={fetchRemoteModelsLoading}
          onClick={async () => {
            setFetchRemoteModelsLoading(true);
            try {
              const result = await fetchRemoteModelList(provider);
              if (result) {
                showUpdateNotification(result);
              }
            } catch (e) {
              console.error(e);
            }
            setFetchRemoteModelsLoading(false);
          }}
          type={'primary'}
        >
          {fetchRemoteModelsLoading
            ? t('providerModels.list.fetcher.fetching')
            : t('providerModels.list.fetcher.fetch')}
        </Button>
      </Flexbox>
    </Center>
  );
});

export default EmptyState;
