'use client';

import { Button, Input, TextArea, toast } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { useMutation } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { credErrorKey } from '../credError';
import CredFormFooter from '../CredFormFooter';
import KVPairsField from '../KVPairsField';
import { createExtras, type CredsApi } from '../useCredsApi';

interface KVCredFormProps {
  credsApi: CredsApi;
  disabled?: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  type: 'kv-env' | 'kv-header';
}

interface FormValues {
  description?: string;
  key: string;
  kvPairs: Array<{ key: string; value: string }>;
  name: string;
}

const KVCredForm: FC<KVCredFormProps> = ({ credsApi, type, disabled, onCancel, onSuccess }) => {
  const { t } = useTranslation('setting');
  const form = useForm<FormValues>({
    initialValues: { kvPairs: [{ key: '', value: '' }] } as FormValues,
    onSubmit: (values) => handleSubmit(values),
  });

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (disabled) return;

      const kvPairs = values.kvPairs || [];
      const valuesObj = kvPairs.reduce(
        (acc, pair) => {
          if (pair.key && pair.value) {
            acc[pair.key] = pair.value;
          }
          return acc;
        },
        {} as Record<string, string>,
      );

      await credsApi.client.createKV.mutate({
        description: values.description,
        key: values.key,
        name: values.name,
        type,
        values: valuesObj,
        ...createExtras(credsApi),
      });
    },
    onError: (error) => {
      toast.error(t(credErrorKey(error, 'creds.errors.createFailed')));
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (values: FormValues) => {
    if (disabled) return;

    createMutation.mutate(values);
  };

  return (
    <Form form={form} layout="vertical">
      <Form.Field label={t('creds.form.name')} name="name" required={t('creds.form.nameRequired')}>
        <Input
          disabled={disabled}
          placeholder={type === 'kv-env' ? 'OpenAI API Key' : 'Internal API Token'}
        />
      </Form.Field>

      <Form.Field
        desc={t('creds.form.keyDesc')}
        label={t('creds.form.key')}
        name="key"
        required={t('creds.form.keyRequired')}
        validate={(value?: string) =>
          value && !/^[\w-]+$/.test(value) ? t('creds.form.keyPattern') : undefined
        }
      >
        <Input disabled={disabled} placeholder={type === 'kv-env' ? 'openai' : 'internal-api'} />
      </Form.Field>

      <KVPairsField disabled={disabled} type={type} />

      <Form.Field label={t('creds.form.description')} name="description">
        <TextArea
          disabled={disabled}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Field>

      <CredFormFooter>
        <Button onClick={onCancel}>{t('creds.form.cancel')}</Button>
        <Button
          disabled={disabled}
          htmlType="submit"
          loading={createMutation.isPending}
          type="primary"
        >
          {t('creds.form.submit')}
        </Button>
      </CredFormFooter>
    </Form>
  );
};

export default KVCredForm;
