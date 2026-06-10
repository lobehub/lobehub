import { Button, Center, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BrainIcon, LucideRefreshCcwDot, PlusIcon } from 'lucide-react';
import { memo, use, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAiInfraStore } from '@/store/aiInfra';

import { createCreateNewModelModal } from './CreateNewModelModal';
import { ProviderSettingsContext } from './ProviderSettingsContext';

const styles = createStaticStyles(({ css, cssVar }) => ({
  circle: css`
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: ${cssVar.colorFillSecondary};
  `,
  container: css`
    width: 100%;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  description: css`
    max-width: 280px;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextDescription};
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
    color: ${cssVar.colorText};
  `,
  title: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: 500;
  `,
}));

const EmptyState = memo<{ provider: string }>(({ provider }) => {
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  const [fetchRemoteModelList] = useAiInfraStore((s) => [s.fetchRemoteModelList]);

  const [fetchRemoteModelsLoading, setFetchRemoteModelsLoading] = useState(false);
  const { showDeployName } = use(ProviderSettingsContext);

  return (
    <Center className={styles.container} gap={24} paddingBlock={40}>
      <Center className={styles.circle}>
        <Icon className={styles.sparklesIcon} icon={BrainIcon} />
      </Center>
      <Flexbox align={'center'} gap={8}>
        <div className={styles.title}>{t('providerModels.list.empty.title')}</div>
        <div className={styles.description}>{t('providerModels.list.empty.desc')}</div>
      </Flexbox>

      <Flexbox horizontal gap={8}>
        <Tooltip title={canManageProvider ? '' : reason}>
          <Button
            disabled={!canManageProvider}
            icon={PlusIcon}
            onClick={() => {
              if (!canManageProvider) return;
              createCreateNewModelModal({ showDeployName });
            }}
          >
            {t('providerModels.list.addNew')}
          </Button>
        </Tooltip>
        <Tooltip title={canManageProvider ? '' : reason}>
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
              } catch (e) {
                console.error(e);
              }
              setFetchRemoteModelsLoading(false);
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
