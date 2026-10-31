import { Button, Center, Flexbox, Icon, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BrainIcon, LucideRefreshCcwDot, PlusIcon } from 'lucide-react';
import { memo, use, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { createCreateNewModelModal } from './CreateNewModelModal';
import { ProviderSettingsContext } from './ProviderSettingsContext';

const styles = stylex.create({
  circle: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  container: {
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  description: {
    maxWidth: '280px',
    fontSize: cssVar.fontSize,
    color: cssVar.colorTextDescription,
    textAlign: 'center',
    textWrap: 'balance',
  },
  sparklesIcon: { fontSize: '40px', color: cssVar.colorText },
  title: { fontSize: cssVar.fontSizeLG, fontWeight: 500 },
});

const EmptyState = memo<{ provider: string }>(({ provider }) => {
  const { t } = useTranslation('modelProvider');

  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  const [fetchRemoteModelList] = useAiInfraStore((s) => [s.fetchRemoteModelList]);

  const [fetchRemoteModelsLoading, setFetchRemoteModelsLoading] = useState(false);
  const { showDeployName } = use(ProviderSettingsContext);

  return (
    <Center className={stylex.props(styles.container).className} gap={24} paddingBlock={40}>
      <Center className={stylex.props(styles.circle).className}>
        <Icon className={stylex.props(styles.sparklesIcon).className} icon={BrainIcon} />
      </Center>
      <Flexbox align={'center'} gap={8}>
        <div {...stylex.props(styles.title)}>{t('providerModels.list.empty.title')}</div>
        <div {...stylex.props(styles.description)}>{t('providerModels.list.empty.desc')}</div>
      </Flexbox>

      <Flexbox horizontal gap={8}>
        <Tooltip title={canManageProvider ? undefined : reason}>
          <Button
            disabled={!canManageProvider}
            icon={PlusIcon}
            onClick={() => {
              if (!canManageProvider) return;
              createCreateNewModelModal({
                existingModelIds: aiModelSelectors
                  .getAiProviderModelList(provider)(useAiInfraStore.getState())
                  .map((model) => model.id),
                showDeployName,
              });
            }}
          >
            {t('providerModels.list.addNew')}
          </Button>
        </Tooltip>
        <Tooltip title={canManageProvider ? undefined : reason}>
          <Button
            disabled={!canManageProvider}
            icon={<Icon icon={LucideRefreshCcwDot} />}
            loading={fetchRemoteModelsLoading}
            type={'primary'}
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

                toast.error(
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
      </Flexbox>
    </Center>
  );
});

export default EmptyState;
