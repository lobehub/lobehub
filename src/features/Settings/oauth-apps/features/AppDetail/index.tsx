'use client';

import {
  ActionIcon,
  Alert,
  Button,
  confirmModal,
  createStaticStyles,
  Flexbox,
  Skeleton,
  Tabs,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import { ArrowLeftIcon, PowerIcon, PowerOffIcon, Trash2Icon } from 'lucide-react';
import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import OAuthAppStats from '@/business/client/OAuthAppStats';
import AsyncError from '@/components/AsyncError';
import { useClientDataSWR } from '@/libs/swr';
import { authKeys } from '@/libs/swr/keys';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

import { confirmDisableOAuthApp } from '../confirmDisable';
import { showClientSecretModal } from '../SecretModal';
import BasicInfoCard from './BasicInfoCard';
import CredentialsCard from './CredentialsCard';
import IntegrationCard from './IntegrationCard';
import ManualSetupCard from './ManualSetupCard';
import RedirectUrisCard from './RedirectUrisCard';
import SectionCard from './SectionCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  dangerCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  dangerDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  dangerRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
  `,
  // The stats slot is a business stub that renders nothing in the open-source
  // build; an empty bordered card must not be left behind.
  statsCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};

    &:empty {
      display: none;
    }
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** The app page while it loads; also shown while the Labs flag resolves on a direct visit. */
export const AppDetailSkeleton = () => (
  <Flexbox gap={16}>
    <Skeleton.Text rows={1} width={200} />
    <div className={styles.card}>
      <Skeleton.Text rows={4} />
    </div>
  </Flexbox>
);

const TAB_KEYS = ['overview', 'credentials', 'advanced'] as const;

interface AppDetailProps {
  canEdit: boolean;
  id: string;
  onBack: () => void;
  onChanged: () => void;
}

const AppDetail: FC<AppDetailProps> = ({ canEdit, id, onBack, onChanged }) => {
  const { t } = useTranslation(['auth', 'common']);

  const { data, error, isLoading, isValidating, mutate } = useClientDataSWR(
    authKeys.oauthAppById(id),
    () => lambdaClient.oauthApp.getById.query({ id }),
  );
  const detail = data as OAuthAppItem | undefined;

  // The active tab lives in the URL so a reload or shared link keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TAB_KEYS.find((key) => key === searchParams.get('tab')) ?? 'overview';
  const setTab = (key: string) =>
    setSearchParams(
      (params) => {
        if (key === 'overview') params.delete('tab');
        else params.set('tab', key);
        return params;
      },
      { replace: true },
    );

  // Only a settled "no such app" goes back to the list; a failed load stays here
  // with Retry instead of silently bouncing the user away.
  useEffect(() => {
    if (!error && !isLoading && !detail) onBack();
  }, [error, isLoading, detail, onBack]);

  const revalidate = () => {
    mutate();
    onChanged();
  };

  const updateMutation = lambdaQuery.oauthApp.update.useMutation({
    onSuccess: () => {
      revalidate();
      toast.success(t('oauthApp.detail.saveSuccess'));
    },
  });
  const enabledMutation = lambdaQuery.oauthApp.setEnabled.useMutation({ onSuccess: revalidate });
  const rotateSecretMutation = lambdaQuery.oauthApp.rotateSecret.useMutation({
    // Minting a credential must never fail silently: the user needs to know no
    // secret is waiting for them and that they can try again.
    onError: () => toast.error(t('oauthApp.secret.issueFailed')),
    onSuccess: ({ clientSecret }) => {
      revalidate();
      showClientSecretModal({ clientSecret });
    },
  });
  const deleteMutation = lambdaQuery.oauthApp.delete.useMutation({
    onSuccess: () => {
      onChanged();
      onBack();
    },
  });

  const handleUpdate = async (value: Parameters<typeof updateMutation.mutateAsync>[0]['value']) => {
    await updateMutation.mutateAsync({ id, value });
  };

  const handleRotateSecret = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('oauthApp.secret.rotateConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('oauthApp.secret.rotateConfirm.ok'),
      onOk: async () => {
        await rotateSecretMutation.mutateAsync({ id });
      },
      title: t('oauthApp.secret.rotateConfirm.title'),
    });

  const handleDelete = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('oauthApp.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('oauthApp.deleteConfirm.ok'),
      onOk: async () => {
        await deleteMutation.mutateAsync({ id });
      },
      title: t('oauthApp.deleteConfirm.title'),
    });

  const handleEnable = () => enabledMutation.mutate({ enabled: true, id });
  const handleDisable = () =>
    confirmDisableOAuthApp(() => enabledMutation.mutateAsync({ enabled: false, id }));

  if (error && !detail)
    return (
      <AsyncError
        error={error}
        variant={'page'}
        action={
          <Flexbox horizontal gap={8}>
            <Button onClick={onBack}>{t('oauthApp.detail.back')}</Button>
            {normalizeAsyncError(error).retryable && (
              <Button loading={isValidating} onClick={() => mutate()}>
                {t('retry', { ns: 'common' })}
              </Button>
            )}
          </Flexbox>
        }
      />
    );

  if (!detail) return <AppDetailSkeleton />;

  const isWebApp = detail.applicationType === 'web';
  const isDisabled = !detail.enabled;
  // Relative times, matching the list rows.
  const meta = [
    t('oauthApp.detail.createdRelative', { time: dayjs(detail.createdAt).fromNow() }),
    detail.lastUsedAt
      ? t('oauthApp.item.lastUsed', { time: dayjs(detail.lastUsedAt).fromNow() })
      : t('oauthApp.list.neverUsed'),
  ].join(' · ');

  const banner = isDisabled && (
    <Alert
      showIcon
      message={t('oauthApp.disabled.banner')}
      type={'warning'}
      action={
        canEdit && (
          <Button loading={enabledMutation.isPending} size={'small'} onClick={handleEnable}>
            {t('oauthApp.actions.enable')}
          </Button>
        )
      }
    />
  );

  // The landing tab: what the app is and how to wire it in.
  const overviewTab = (
    <>
      <BasicInfoCard
        canEdit={canEdit}
        detail={detail}
        key={`basic-${detail.id}`}
        onSubmit={handleUpdate}
      />
      <IntegrationCard
        applicationType={detail.applicationType}
        clientId={detail.id}
        name={detail.name}
      />
      <div className={styles.statsCard}>
        <OAuthAppStats clientId={detail.id} />
      </div>
    </>
  );

  const credentialsTab = (
    <>
      <CredentialsCard
        canEdit={canEdit}
        detail={detail}
        secretPending={rotateSecretMutation.isPending}
        onGenerateSecret={() => rotateSecretMutation.mutate({ id })}
        onRotateSecret={handleRotateSecret}
      />
      {isWebApp && (
        <RedirectUrisCard
          canEdit={canEdit}
          detail={detail}
          key={`redirect-${detail.id}`}
          onSubmit={handleUpdate}
        />
      )}
      {/* Reference material for configuring a client by hand: last, folded. */}
      <ManualSetupCard applicationType={detail.applicationType} />
    </>
  );

  // Enable / disable is reversible, so it lives in its own section; only the
  // irreversible delete sits in the danger zone.
  const advancedTab = (
    <>
      <SectionCard title={t('oauthApp.detail.status')}>
        <div className={styles.dangerRow}>
          <Flexbox gap={2}>
            <Text>{t(isDisabled ? 'oauthApp.actions.enable' : 'oauthApp.actions.disable')}</Text>
            <span className={styles.dangerDesc}>
              {t(isDisabled ? 'oauthApp.detail.enableDesc' : 'oauthApp.detail.disableDesc')}
            </span>
          </Flexbox>
          <Button
            disabled={!canEdit}
            icon={isDisabled ? <PowerIcon size={16} /> : <PowerOffIcon size={16} />}
            loading={enabledMutation.isPending}
            style={{ flex: 'none' }}
            onClick={isDisabled ? handleEnable : handleDisable}
          >
            {t(isDisabled ? 'oauthApp.actions.enable' : 'oauthApp.actions.disable')}
          </Button>
        </div>
      </SectionCard>

      <Flexbox className={styles.dangerCard} gap={16}>
        <Text weight={500}>{t('oauthApp.detail.dangerZone')}</Text>
        <div className={styles.dangerRow}>
          <Flexbox gap={2}>
            <Text>{t('oauthApp.detail.delete')}</Text>
            <span className={styles.dangerDesc}>{t('oauthApp.detail.deleteDesc')}</span>
          </Flexbox>
          <Button
            danger
            disabled={!canEdit}
            icon={<Trash2Icon size={16} />}
            loading={deleteMutation.isPending}
            style={{ flex: 'none' }}
            onClick={handleDelete}
          >
            {t('oauthApp.detail.delete')}
          </Button>
        </div>
      </Flexbox>
    </>
  );

  return (
    <Flexbox gap={20}>
      {/* The disabled state is about the whole app, so it heads the page. */}
      {banner}

      <Flexbox gap={4}>
        <Flexbox horizontal align={'center'} gap={8}>
          <ActionIcon
            aria-label={t('oauthApp.detail.back')}
            icon={ArrowLeftIcon}
            size={'small'}
            title={t('oauthApp.detail.back')}
            onClick={onBack}
          />
          <Text strong style={{ fontSize: 20 }}>
            {detail.name}
          </Text>
          {isDisabled && <Tag>{t('oauthApp.item.disabledTag')}</Tag>}
        </Flexbox>
        <span className={styles.meta} style={{ paddingInlineStart: 36 }}>
          {meta}
        </span>
      </Flexbox>

      <Tabs
        activeKey={tab}
        items={[
          { key: 'overview', label: t('oauthApp.detail.tabs.overview') },
          { key: 'credentials', label: t('oauthApp.detail.tabs.credentials') },
          { key: 'advanced', label: t('oauthApp.detail.tabs.advanced') },
        ]}
        onChange={setTab}
      />

      {tab === 'overview' && overviewTab}
      {tab === 'credentials' && credentialsTab}
      {tab === 'advanced' && advancedTab}
    </Flexbox>
  );
};

export default AppDetail;
