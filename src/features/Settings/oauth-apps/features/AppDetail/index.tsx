'use client';

import {
  ActionIcon,
  Alert,
  Button,
  confirmModal,
  Flexbox,
  Tabs,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ArrowLeftIcon, PowerIcon, PowerOffIcon, Trash2Icon } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import OAuthAppStats from '@/business/client/OAuthAppStats';
import AsyncError from '@/components/AsyncError';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { oauthAppSelectors, useOAuthAppStore } from '@/store/oauthApp';
import { type UpdateOAuthAppParams } from '@/types/oauthApp';

import AppDetailSkeleton from '../AppDetailSkeleton';
import { confirmDisableOAuthApp } from '../confirmDisable';
import { showClientSecretModal } from '../SecretModal';
import BasicInfoCard from './BasicInfoCard';
import CredentialsCard from './CredentialsCard';
import IntegrationCard from './IntegrationCard';
import ManualSetupCard from './ManualSetupCard';
import RedirectUrisCard from './RedirectUrisCard';
import SectionCard from './SectionCard';

const styles = stylex.create({
  dangerCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorErrorBorder,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  dangerDesc: { fontSize: '12px', color: cssVar.colorTextSecondary },
  dangerRow: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The stats slot is a business stub that renders nothing in the open-source
  // build; an empty bordered card must not be left behind.
  statsCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    display: { 'default': null, ':empty': 'none' },
  },
  meta: { fontSize: '12px', color: cssVar.colorTextTertiary },
});

export { default as AppDetailSkeleton } from '../AppDetailSkeleton';

const TAB_KEYS = ['overview', 'credentials', 'advanced'] as const;

interface AppDetailProps {
  canEdit: boolean;
  id: string;
  onBack: () => void;
}

const AppDetail: FC<AppDetailProps> = ({ canEdit, id, onBack }) => {
  const { t } = useTranslation(['auth', 'common']);

  const [useFetchAppDetail, updateApp, setAppEnabled, rotateSecret, deleteApp] = useOAuthAppStore(
    (s) => [s.useFetchAppDetail, s.updateApp, s.setAppEnabled, s.rotateSecret, s.deleteApp],
  );
  // The persisted copy paints the page on open; the network only confirms.
  const { error, isValidating, revalidate } = useFetchAppDetail(id);
  const detail = useOAuthAppStore(oauthAppSelectors.appById(id));
  const notFound = useOAuthAppStore(oauthAppSelectors.isAppNotFound(id));

  const [enabledPending, setEnabledPending] = useState(false);
  const [secretPending, setSecretPending] = useState(false);

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
    if (notFound) onBack();
  }, [notFound, onBack]);

  const handleUpdate = async (value: UpdateOAuthAppParams) => {
    await updateApp(id, value);
    toast.success(t('oauthApp.detail.saveSuccess'));
  };

  const setEnabled = async (enabled: boolean) => {
    setEnabledPending(true);
    try {
      await setAppEnabled(id, enabled);
    } finally {
      setEnabledPending(false);
    }
  };

  const issueSecret = async () => {
    setSecretPending(true);
    try {
      showClientSecretModal({ clientSecret: await rotateSecret(id) });
    } catch (error) {
      // Minting a credential must never fail silently: the user needs to know no
      // secret is waiting for them and that they can try again.
      toast.error(t('oauthApp.secret.issueFailed'));
      throw error;
    } finally {
      setSecretPending(false);
    }
  };

  const handleRotateSecret = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('oauthApp.secret.rotateConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('oauthApp.secret.rotateConfirm.ok'),
      onOk: issueSecret,
      title: t('oauthApp.secret.rotateConfirm.title'),
    });

  const handleDelete = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('oauthApp.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('oauthApp.deleteConfirm.ok'),
      // The delete is optimistic: go back to the list, where the row is
      // already gone and comes back if the call fails.
      onOk: async () => {
        onBack();
        await deleteApp(id);
      },
      title: t('oauthApp.deleteConfirm.title'),
    });

  // A failed enable rolls the page back to disabled.
  const handleEnable = () => void setEnabled(true).catch(() => {});
  const handleDisable = () => confirmDisableOAuthApp(() => setEnabled(false));

  if (error && !detail)
    return (
      <AsyncError
        error={error}
        variant={'page'}
        action={
          <Flexbox horizontal gap={8}>
            <Button onClick={onBack}>{t('oauthApp.detail.back')}</Button>
            {normalizeAsyncError(error).retryable && (
              <Button loading={isValidating} onClick={() => void revalidate()}>
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
          <Button loading={enabledPending} size={'small'} onClick={handleEnable}>
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
      <div {...stylex.props(styles.statsCard)}>
        <OAuthAppStats clientId={detail.id} />
      </div>
    </>
  );

  const credentialsTab = (
    <>
      <CredentialsCard
        canEdit={canEdit}
        detail={detail}
        secretPending={secretPending}
        onGenerateSecret={() => void issueSecret().catch(() => {})}
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
        <div {...stylex.props(styles.dangerRow)}>
          <Flexbox gap={2}>
            <Text>{t(isDisabled ? 'oauthApp.actions.enable' : 'oauthApp.actions.disable')}</Text>
            <span {...stylex.props(styles.dangerDesc)}>
              {t(isDisabled ? 'oauthApp.detail.enableDesc' : 'oauthApp.detail.disableDesc')}
            </span>
          </Flexbox>
          <Button
            disabled={!canEdit}
            icon={isDisabled ? <PowerIcon size={16} /> : <PowerOffIcon size={16} />}
            loading={enabledPending}
            style={{ flex: 'none' }}
            onClick={isDisabled ? handleEnable : handleDisable}
          >
            {t(isDisabled ? 'oauthApp.actions.enable' : 'oauthApp.actions.disable')}
          </Button>
        </div>
      </SectionCard>

      <Flexbox className={stylex.props(styles.dangerCard).className} gap={16}>
        <Text weight={500}>{t('oauthApp.detail.dangerZone')}</Text>
        <div {...stylex.props(styles.dangerRow)}>
          <Flexbox gap={2}>
            <Text>{t('oauthApp.detail.delete')}</Text>
            <span {...stylex.props(styles.dangerDesc)}>{t('oauthApp.detail.deleteDesc')}</span>
          </Flexbox>
          <Button
            danger
            disabled={!canEdit}
            icon={<Trash2Icon size={16} />}
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
        <span className={stylex.props(styles.meta).className} style={{ paddingInlineStart: 36 }}>
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
