'use client';

import { Drawer, Flexbox, Input, Tag, Text, TextArea } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { App, Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Trash } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import OAuthAppStats from '@/business/client/OAuthAppStats';
import AvatarUpload from '@/components/AvatarUpload';
import { useClientDataSWR } from '@/libs/swr';
import { authKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

import ClientIdDisplay from '../ClientIdDisplay';

const styles = createStaticStyles(({ css, cssVar }) => ({
  field: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
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

interface DetailBodyProps {
  app: OAuthAppItem;
  canEdit: boolean;
  onChanged: () => void;
  onClose: () => void;
}

const DetailBody: FC<DetailBodyProps> = ({ app, canEdit, onChanged, onClose }) => {
  const { t } = useTranslation('auth');
  const { message } = App.useApp();
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description ?? '');
  const [logoUri, setLogoUri] = useState(app.logoUri ?? undefined);

  const { data, mutate } = useClientDataSWR(authKeys.oauthAppById(app.id), () =>
    lambdaClient.oauthApp.getById.query({ id: app.id }),
  );
  const detail = (data as OAuthAppItem | undefined) ?? app;

  const revalidate = () => {
    mutate();
    onChanged();
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      lambdaClient.oauthApp.update.mutate({ id: app.id, value: { description, logoUri, name } }),
    onSuccess: () => {
      message.success(t('oauthApp.detail.saveSuccess'));
      revalidate();
    },
  });

  const enabledMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      lambdaClient.oauthApp.setEnabled.mutate({ enabled, id: app.id }),
    onSuccess: () => revalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: () => lambdaClient.oauthApp.delete.mutate({ id: app.id }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setLogoUri(reader.result as string);
    });
    reader.readAsDataURL(file);
  };

  return (
    <Flexbox gap={20} paddingBlock={8}>
      <AvatarUpload
        title={detail.name}
        value={logoUri}
        onUpload={canEdit ? handleUpload : undefined}
      />

      <div className={styles.field}>
        <span className={styles.label}>{t('oauthApp.form.name.label')}</span>
        <Input disabled={!canEdit} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{t('oauthApp.form.description.label')}</span>
        <TextArea
          disabled={!canEdit}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <Button
        block
        disabled={!canEdit || !name}
        loading={updateMutation.isPending}
        type={'primary'}
        onClick={() => updateMutation.mutate()}
      >
        {t('oauthApp.detail.save')}
      </Button>

      <div className={styles.field}>
        <span className={styles.label}>{t('oauthApp.detail.clientId')}</span>
        <ClientIdDisplay clientId={app.id} />
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
          {detail.lastUsedAt ? detail.lastUsedAt.toLocaleString() : t('oauthApp.detail.neverUsed')}
        </Text>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('oauthApp.detail.enabled')}</span>
        <Switch
          checked={!!detail.enabled}
          disabled={!canEdit || enabledMutation.isPending}
          onChange={(checked) => enabledMutation.mutate(checked)}
        />
      </div>

      <OAuthAppStats clientId={app.id} />

      <Popconfirm
        cancelText={t('oauthApp.deleteConfirm.cancel')}
        description={t('oauthApp.deleteConfirm.content')}
        okButtonProps={{ danger: true, disabled: !canEdit }}
        okText={t('oauthApp.deleteConfirm.ok')}
        title={t('oauthApp.deleteConfirm.title')}
        onConfirm={() => deleteMutation.mutate()}
      >
        <Button
          block
          danger
          disabled={!canEdit}
          icon={<Trash size={16} />}
          loading={deleteMutation.isPending}
        >
          {t('oauthApp.detail.delete')}
        </Button>
      </Popconfirm>
    </Flexbox>
  );
};

interface AppDetailProps {
  app?: OAuthAppItem;
  canEdit: boolean;
  onChanged: () => void;
  onClose: () => void;
}

const AppDetail: FC<AppDetailProps> = ({ app, canEdit, onChanged, onClose }) => {
  const { t } = useTranslation('auth');

  return (
    <Drawer
      open={!!app}
      placement={'right'}
      title={t('oauthApp.detail.title')}
      width={'min(90vw, 420px)'}
      onClose={onClose}
    >
      {app && (
        <DetailBody
          app={app}
          canEdit={canEdit}
          key={app.id}
          onChanged={onChanged}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
};

export default AppDetail;
