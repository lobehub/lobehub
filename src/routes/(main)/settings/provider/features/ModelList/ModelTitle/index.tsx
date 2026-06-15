import { ActionIcon, Button, DropdownMenu, Flexbox, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App, Space } from 'antd';
import { cssVar } from 'antd-style';
import { CircleX, EllipsisVertical, LucideRefreshCcwDot, PlusIcon } from 'lucide-react';
import { memo, use, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';

import { createCreateNewModelModal } from '../CreateNewModelModal';
import { ProviderSettingsContext } from '../ProviderSettingsContext';
import Search from './Search';

interface ModelFetcherProps {
  provider: string;
  showAddNewModel?: boolean;
  showModelFetcher?: boolean;
}

const ModelTitle = memo<ModelFetcherProps>(
  ({ provider, showAddNewModel = true, showModelFetcher = true }) => {
    const { t } = useTranslation('modelProvider');
    const { message } = App.useApp();
    const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');
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
    const { showDeployName } = use(ProviderSettingsContext);

    const mobile = useIsMobile();

    useEffect(() => {
      useAiInfraStore.setState({ modelSearchKeyword: '' });
    }, [provider]);

    return (
      <Flexbox
        gap={12}
        paddingBlock={8}
        style={{
          background: cssVar.colorBgContainer,
          marginTop: mobile ? 0 : -12,
          paddingTop: mobile ? 0 : 20,
          position: 'sticky',
          top: mobile ? -2 : -32,
          zIndex: 15,
        }}
      >
        <Flexbox horizontal align={'center'} gap={0} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
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
                      disabled={!canManageProvider}
                      icon={CircleX}
                      loading={clearRemoteModelsLoading}
                      size={'small'}
                      title={canManageProvider ? t('providerModels.list.fetcher.clear') : undefined}
                      onClick={async () => {
                        if (!canManageProvider) return;
                        setClearRemoteModelsLoading(true);
                        await clearObtainedModels(provider);
                        setClearRemoteModelsLoading(false);
                      }}
                    />
                  )}
                </div>
              </Text>
            )}
          </Flexbox>
          {isLoading ? (
            <Skeleton.Button active size={'small'} style={{ width: 120 }} />
          ) : isEmpty ? null : (
            <Flexbox horizontal gap={8}>
              {!mobile && (
                <Search
                  value={searchKeyword}
                  onChange={(value) => {
                    useAiInfraStore.setState({ modelSearchKeyword: value });
                  }}
                />
              )}
              <Space.Compact>
                {showModelFetcher && (
                  <Tooltip title={canManageProvider ? '' : reason}>
                    <Button
                      disabled={!canManageProvider}
                      icon={LucideRefreshCcwDot}
                      loading={fetchRemoteModelsLoading}
                      size={'small'}
                      onClick={async () => {
                        if (!canManageProvider) return;
                        setFetchRemoteModelsLoading(true);
                        try {
                          await fetchRemoteModelList(provider);
                        } catch (error) {
                          console.error(error);

                          const errorMessage =
                            error instanceof Error
                              ? error.message
                              : t('providerModels.list.fetcher.errorFallback');

                          message.error(
                            t('providerModels.list.fetcher.error', {
                              message: errorMessage,
                            }),
                          );
                        } finally {
                          setFetchRemoteModelsLoading(false);
                        }
                      }}
                    >
                      {fetchRemoteModelsLoading
                        ? t('providerModels.list.fetcher.fetching')
                        : t('providerModels.list.fetcher.fetch')}
                    </Button>
                  </Tooltip>
                )}
                {showAddNewModel && (
                  <Tooltip title={canManageProvider ? '' : reason}>
                    <Button
                      disabled={!canManageProvider}
                      icon={PlusIcon}
                      size={'small'}
                      onClick={() => {
                        if (!canManageProvider) return;
                        createCreateNewModelModal({ showDeployName });
                      }}
                    />
                  </Tooltip>
                )}
                <DropdownMenu
                  items={[
                    {
                      disabled: !canManageProvider,
                      key: 'reset',
                      label: t('providerModels.list.resetAll.title'),
                      onClick: async () => {
                        if (!canManageProvider) return;
                        confirmModal({
                          content: t('providerModels.list.resetAll.conform'),
                          onOk: async () => {
                            await clearModelsByProvider(provider);
                            message.success(t('providerModels.list.resetAll.success'));
                          },
                          title: t('providerModels.list.resetAll.title'),
                        });
                      },
                    },
                  ]}
                >
                  <Button icon={EllipsisVertical} size={'small'} />
                </DropdownMenu>
              </Space.Compact>
            </Flexbox>
          )}
        </Flexbox>

        {mobile && (
          <Search
            value={searchKeyword}
            variant={'filled'}
            onChange={(value) => {
              useAiInfraStore.setState({ modelSearchKeyword: value });
            }}
          />
        )}
      </Flexbox>
    );
  },
);
export default ModelTitle;
