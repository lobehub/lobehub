'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Button, Flexbox, Input, Spin, TextArea } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { useMutation } from '@tanstack/react-query';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import CredFormFooter from '../CredFormFooter';
import KVPairsField from '../KVPairsField';
import { type CredsApi } from '../useCredsApi';
import { buildKVUpdateInput } from './kvUpdateInput';

interface EditKVFormProps {
  cred: UserCredSummary;
  credsApi: CredsApi;
  onCancel: () => void;
  onSuccess: () => void;
  /**
   * The stored values cannot be read back: the form starts empty, leaving it
   * empty keeps them, and filling it in replaces them all.
   */
  writeOnly?: boolean;
}

interface FormValues {
  description?: string;
  kvPairs: Array<{ key: string; value: string }>;
  name: string;
}

const EditKVForm: FC<EditKVFormProps> = ({ cred, credsApi, onCancel, onSuccess, writeOnly }) => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const form = useForm<FormValues>({ onSubmit: (values) => handleSubmit(values) });
  const [isLoading, setIsLoading] = useState(true);

  // Fetch decrypted values on mount
  useEffect(() => {
    const fetchDecryptedValues = async () => {
      if (writeOnly) {
        form.setValues({
          description: cred.description,
          kvPairs: [{ key: '', value: '' }],
          name: cred.name,
        });
        setIsLoading(false);
        return;
      }

      if (!canManageCredentials) {
        setIsLoading(false);
        return;
      }

      try {
        const result = await credsApi.client.get.query({
          decrypt: true,
          id: cred.id,
        });

        // Convert values object to array of key-value pairs
        const values = (result as any).plaintext || {};
        const kvPairs = Object.entries(values).map(([key, value]) => ({
          key,
          value: value as string,
        }));

        form.setValues({
          description: cred.description,
          kvPairs: kvPairs.length > 0 ? kvPairs : [{ key: '', value: '' }],
          name: cred.name,
        });
      } catch {
        // If decryption fails, just show empty values
        form.setValues({
          description: cred.description,
          kvPairs: [{ key: '', value: '' }],
          name: cred.name,
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchDecryptedValues();
  }, [canManageCredentials, cred.id, cred.name, cred.description, credsApi, form, writeOnly]);

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!canManageCredentials) return;

      await credsApi.client.update.mutate(buildKVUpdateInput(cred.id, values, writeOnly));
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (values: FormValues) => {
    if (!canManageCredentials) return;

    updateMutation.mutate(values);
  };

  if (isLoading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flexbox>
    );
  }

  return (
    <Form form={form} layout="vertical">
      <Form.Field label={t('creds.form.name')} name="name" required={t('creds.form.nameRequired')}>
        <Input disabled={!canManageCredentials} />
      </Form.Field>

      <KVPairsField
        disabled={!canManageCredentials}
        hint={writeOnly ? t('creds.writeOnly.editHint') : undefined}
        type={cred.type as 'kv-env' | 'kv-header'}
      />

      <Form.Field label={t('creds.form.description')} name="description">
        <TextArea
          disabled={!canManageCredentials}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Field>

      <CredFormFooter>
        <Button onClick={onCancel}>{t('creds.form.cancel')}</Button>
        <Button
          disabled={!canManageCredentials}
          htmlType="submit"
          loading={updateMutation.isPending}
          type="primary"
        >
          {t('creds.form.save')}
        </Button>
      </CredFormFooter>
    </Form>
  );
};

export default EditKVForm;
