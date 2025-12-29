import { ActionIcon, Button, Dropdown, Text } from '@lobehub/ui';
import { App, Skeleton, Space } from 'antd';
import { useTheme } from 'antd-style';
import { CircleX, EllipsisVertical, LucideRefreshCcwDot, PlusIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';
import { ModelUpdateResult } from '@/store/aiInfra/slices/aiModel/types';

import CreateNewModelModal from '../CreateNewModelModal';
import { UpdateNotificationContent } from '../UpdateNotification';
import Search from './Search';

interface ModelFetcherProps {
  provider: string;
  showAddNewModel?: boolean;
  showModelFetcher?: boolean;
}

const ModelTitle = memo<ModelFetcherProps>(
  ({ provider, showAddNewModel = true, showModelFetcher = true }) => {
    const theme = useTheme();
    const { t } = useTranslation('modelProvider');
    const { modal, message, notification } = App.useApp();
    const [
      searchKeyword,
      totalModels,
      isEmpty,
      hasRemoteModels,
      fetchRemoteModelList,
      clearObtainedModels,
      clearModelsByProvider,
      useFetchAiProviderModels,
    ] = useAiInfraStore((s) => [
      s.modelSearchKeyword,
      aiModelSelectors.totalAiProviderModelList(s),
      aiModelSelectors.isEmptyAiProviderModelList(s),
      aiModelSelectors.hasRemoteModels(s),
      s.fetchRemoteModelList,
      s.clearRemoteModels,
      s.clearModelsByProvider,
      s.useFetchAiProviderModels,
    ]);

    const { isLoading } = useFetchAiProviderModels(provider);

    const [fetchRemoteModelsLoading, setFetchRemoteModelsLoading] = useState(false);
    const [clearRemoteModelsLoading, setClearRemoteModelsLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);

    const mobile = useIsMobile();

    const showUpdateNotification = useCallback(
      (result: ModelUpdateResult) => {
        const { added, builtinNotInRemote, removedFromList, removedButBuiltin } = result;
        const hasChanges =
          added.length > 0 ||
          removedFromList.length > 0 ||
          removedButBuiltin.length > 0 ||
          builtinNotInRemote.length > 0;

        if (!hasChanges) {
          message.success(t('providerModels.list.fetcher.updateResult.noChanges'));
          return;
        }

        const notificationKey = `model-update-${Date.now()}`;
        let dismissed = false;
        const closeNotification = () => {
          if (dismissed) return;
          dismissed = true;
          notification.destroy(notificationKey);
        };

        const isOutdated = removedButBuiltin.length > 0 || builtinNotInRemote.length > 0;
        const notificationStyle = { overflow: 'hidden', position: 'relative' as const, width: 380 };

        if (isOutdated) {
          notification.warning({
            description: (
              <UpdateNotificationContent
                added={added}
                builtinNotInRemote={builtinNotInRemote}
                onAutoClose={closeNotification}
                removedButBuiltin={removedButBuiltin}
                removedFromList={removedFromList}
              />
            ),
            duration: null,
            key: notificationKey,
            message: t('providerModels.list.fetcher.updateResult.removedButBuiltinTitle'),
            onClose: () => {
              dismissed = true;
            },
            style: notificationStyle,
          });
        } else {
          notification.success({
            description: (
              <UpdateNotificationContent
                added={added}
                builtinNotInRemote={builtinNotInRemote}
                onAutoClose={closeNotification}
                removedButBuiltin={removedButBuiltin}
                removedFromList={removedFromList}
              />
            ),
            duration: null,
            key: notificationKey,
            message: t('providerModels.list.fetcher.updateResult.title'),
            onClose: () => {
              dismissed = true;
            },
            style: notificationStyle,
          });
        }
      },
      [notification, t, message],
    );

    return (
      <Flexbox
        gap={12}
        paddingBlock={8}
        style={{
          background: theme.colorBgContainer,
          marginTop: mobile ? 0 : -12,
          paddingTop: mobile ? 0 : 20,
          position: 'sticky',
          top: mobile ? -2 : -32,
          zIndex: 15,
        }}
      >
        <Flexbox align={'center'} gap={0} horizontal justify={'space-between'}>
          <Flexbox align={'center'} gap={8} horizontal>
            <Text strong style={{ fontSize: 16 }}>
              {t('providerModels.list.title')}
            </Text>

            {isLoading ? (
              <Skeleton.Button active style={{ height: 22 }} />
            ) : (
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                <div style={{ display: 'flex', lineHeight: '24px' }}>
                  {t('providerModels.list.total', { count: totalModels })}
                  {hasRemoteModels && (
                    <ActionIcon
                      icon={CircleX}
                      loading={clearRemoteModelsLoading}
                      onClick={async () => {
                        setClearRemoteModelsLoading(true);
                        await clearObtainedModels(provider);
                        setClearRemoteModelsLoading(false);
                      }}
                      size={'small'}
                      title={t('providerModels.list.fetcher.clear')}
                    />
                  )}
                </div>
              </Text>
            )}
          </Flexbox>
          {isLoading ? (
            <Skeleton.Button active size={'small'} style={{ width: 120 }} />
          ) : isEmpty ? null : (
            <Flexbox gap={8} horizontal>
              {!mobile && (
                <Search
                  onChange={(value) => {
                    useAiInfraStore.setState({ modelSearchKeyword: value });
                  }}
                  value={searchKeyword}
                />
              )}
              <Space.Compact>
                {showModelFetcher && (
                  <Button
                    icon={LucideRefreshCcwDot}
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
                    size={'small'}
                  >
                    {fetchRemoteModelsLoading
                      ? t('providerModels.list.fetcher.fetching')
                      : t('providerModels.list.fetcher.fetch')}
                  </Button>
                )}
                {showAddNewModel && (
                  <>
                    <Button
                      icon={PlusIcon}
                      onClick={() => {
                        setShowModal(true);
                      }}
                      size={'small'}
                    />
                    <CreateNewModelModal open={showModal} setOpen={setShowModal} />
                  </>
                )}
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'reset',
                        label: t('providerModels.list.resetAll.title'),
                        onClick: async () => {
                          modal.confirm({
                            content: t('providerModels.list.resetAll.conform'),
                            onOk: async () => {
                              await clearModelsByProvider(provider);
                              message.success(t('providerModels.list.resetAll.success'));
                            },
                            title: t('providerModels.list.resetAll.title'),
                          });
                        },
                      },
                    ],
                  }}
                >
                  <Button icon={EllipsisVertical} size={'small'} />
                </Dropdown>
              </Space.Compact>
            </Flexbox>
          )}
        </Flexbox>

        {mobile && (
          <Search
            onChange={(value) => {
              useAiInfraStore.setState({ modelSearchKeyword: value });
            }}
            value={searchKeyword}
            variant={'filled'}
          />
        )}
      </Flexbox>
    );
  },
);
export default ModelTitle;
