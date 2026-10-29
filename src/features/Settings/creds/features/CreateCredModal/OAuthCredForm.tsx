'use client';

import { Avatar, Button, Empty, Flexbox, Input, Select, Spin, TextArea } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useMutation } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { type CredsApi } from '../useCredsApi';

const styles = stylex.create({
  connectionOption: { display: 'flex', gap: '8px', alignItems: 'center' },
  footer: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginBlockStart: '24px' },
  provider: { fontWeight: 500 },
  username: { color: cssVar.colorTextSecondary },
});

interface OAuthCredFormProps {
  credsApi: CredsApi;
  disabled?: boolean;
  onBack: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  key: string;
  name: string;
  oauthConnectionId: number;
}

const OAuthCredForm: FC<OAuthCredFormProps> = ({ credsApi, disabled, onBack, onSuccess }) => {
  const { t } = useTranslation('setting');
  const form = useForm<FormValues>({ onSubmit: (values) => handleSubmit(values) });

  const { data: connectionsData, isLoading } = credsApi.query.listOAuthConnections.useQuery();

  const connections = connectionsData?.connections ?? [];
  const connectionOptions = connections.map((conn: any) => {
    const provider = conn.providerId || 'OAuth';
    const displayName = conn.providerName || conn.providerUserName || conn.email || conn.name;

    return {
      label: (
        <span {...stylex.props(styles.connectionOption)}>
          {conn.avatar && <Avatar avatar={conn.avatar} size={24} />}
          <span>
            <span {...stylex.props(styles.provider)}>{provider}</span>
            {displayName && <span {...stylex.props(styles.username)}> - {displayName}</span>}
          </span>
        </span>
      ),
      title: [provider, displayName].filter(Boolean).join(' '),
      value: conn.id,
    };
  });

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (disabled) return;

      await credsApi.client.createOAuth.mutate({
        description: values.description,
        key: values.key,
        name: values.name,
        oauthConnectionId: values.oauthConnectionId,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (values: FormValues) => {
    if (disabled) return;

    createMutation.mutate(values);
  };

  if (isLoading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flexbox>
    );
  }

  if (connections.length === 0) {
    return (
      <Flexbox gap={16}>
        <Empty description={t('creds.oauth.noConnections')} />
        <div {...stylex.props(styles.footer)}>
          <Button onClick={onBack}>{t('creds.form.back')}</Button>
        </div>
      </Flexbox>
    );
  }

  return (
    <Form form={form} layout="vertical">
      <Form.Field
        label={t('creds.form.selectConnection')}
        name="oauthConnectionId"
        required={t('creds.form.connectionRequired')}
      >
        <Select
          disabled={disabled}
          options={connectionOptions}
          placeholder={t('creds.form.selectConnectionPlaceholder')}
        />
      </Form.Field>

      <Form.Field
        label={t('creds.form.key')}
        name="key"
        required={t('creds.form.keyRequired')}
        validate={(value?: string) =>
          value && !/^[\w-]+$/.test(value) ? t('creds.form.keyPattern') : undefined
        }
      >
        <Input disabled={disabled} placeholder="e.g., github-oauth" />
      </Form.Field>

      <Form.Field label={t('creds.form.name')} name="name" required={t('creds.form.nameRequired')}>
        <Input disabled={disabled} placeholder="e.g., GitHub Connection" />
      </Form.Field>

      <Form.Field label={t('creds.form.description')} name="description">
        <TextArea
          disabled={disabled}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Field>

      <div {...stylex.props(styles.footer)}>
        <Button onClick={onBack}>{t('creds.form.back')}</Button>
        <Button
          disabled={disabled}
          htmlType="submit"
          loading={createMutation.isPending}
          type="primary"
        >
          {t('creds.form.submit')}
        </Button>
      </div>
    </Form>
  );
};

export default OAuthCredForm;
