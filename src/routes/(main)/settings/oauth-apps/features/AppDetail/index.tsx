'use client';

import { Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button, confirmModal, Switch } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react';
import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import OAuthAppStats from '@/business/client/OAuthAppStats';
import { useClientDataSWR } from '@/libs/swr';
import { authKeys } from '@/libs/swr/keys';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

import ClientIdDisplay from '../ClientIdDisplay';
import EditForm from './EditForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  backButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
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
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
}));

interface AppDetailProps {
  canEdit: boolean;
  id: string;
  onBack: () => void;
  onChanged: () => void;
}

const AppDetail: FC<AppDetailProps> = ({ canEdit, id, onBack, onChanged }) => {
  const { t } = useTranslation('auth');
  const { message } = App.useApp();

  const { data, error, isLoading, mutate } = useClientDataSWR(authKeys.oauthAppById(id), () =>
    lambdaClient.oauthApp.getById.query({ id }),
  );
  const detail = data as OAuthAppItem | undefined;

  useEffect(() => {
    if (error || (!isLoading && !detail)) onBack();
  }, [error, isLoading, detail, onBack]);

  const revalidate = () => {
    mutate();
    onChanged();
  };

  const updateMutation = lambdaQuery.oauthApp.update.useMutation({
    onSuccess: () => {
      revalidate();
      message.success(t('oauthApp.detail.saveSuccess'));
    },
  });
  const enabledMutation = lambdaQuery.oauthApp.setEnabled.useMutation({ onSuccess: revalidate });
  const deleteMutation = lambdaQuery.oauthApp.delete.useMutation({
    onSuccess: () => {
      onChanged();
      onBack();
    },
  });

  const handleDelete = () =>
    confirmModal({
      content: t('oauthApp.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('oauthApp.deleteConfirm.ok'),
      onOk: async () => {
        await deleteMutation.mutateAsync({ id });
      },
      title: t('oauthApp.deleteConfirm.title'),
    });

  if (!detail)
    return (
      <Flexbox gap={16}>
        <Skeleton active paragraph={{ rows: 1, width: 200 }} title={false} />
        <div className={styles.card}>
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        </div>
      </Flexbox>
    );

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align={'center'} gap={8}>
        <span
          aria-label={t('oauthApp.detail.back')}
          className={styles.backButton}
          role={'button'}
          tabIndex={0}
          onClick={onBack}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onBack();
            }
          }}
        >
          <Icon icon={ArrowLeftIcon} size={'small'} />
        </span>
        <Text strong style={{ fontSize: 20 }}>
          {detail.name}
        </Text>
        {!detail.enabled && <Tag>{t('oauthApp.item.disabledTag')}</Tag>}
      </Flexbox>

      <div className={styles.card}>
        <EditForm
          canEdit={canEdit}
          detail={detail}
          key={detail.id}
          onSubmit={async (value) => {
            await updateMutation.mutateAsync({ id, value });
          }}
        />
      </div>

      <Flexbox className={styles.card} gap={16}>
        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.clientId')}</span>
          <ClientIdDisplay clientId={detail.id} />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.type')}</span>
          <Tag>{t('oauthApp.type.badge')}</Tag>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.createdAt')}</span>
          <Text type={'secondary'}>{detail.createdAt.toLocaleString()}</Text>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.lastUsedAt')}</span>
          <Text type={'secondary'}>
            {detail.lastUsedAt
              ? detail.lastUsedAt.toLocaleString()
              : t('oauthApp.detail.neverUsed')}
          </Text>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t('oauthApp.detail.enabled')}</span>
          <Switch
            checked={!!detail.enabled}
            disabled={!canEdit || enabledMutation.isPending}
            onChange={(checked) => enabledMutation.mutate({ enabled: checked, id })}
          />
        </div>
      </Flexbox>

      <div className={styles.card}>
        <OAuthAppStats clientId={detail.id} />
      </div>

      <Flexbox className={styles.dangerCard} gap={12}>
        <Text weight={500}>{t('oauthApp.detail.dangerZone')}</Text>
        <div className={styles.row}>
          <Button
            danger
            disabled={!canEdit}
            icon={<Trash2Icon size={16} />}
            loading={deleteMutation.isPending}
            onClick={handleDelete}
          >
            {t('oauthApp.detail.delete')}
          </Button>
        </div>
      </Flexbox>
    </Flexbox>
  );
};

export default AppDetail;
