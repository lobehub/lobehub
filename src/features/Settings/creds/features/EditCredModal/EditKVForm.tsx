'use client';

import { type UserCredSummary } from '@lobechat/types';
import {
  Button,
  createStaticStyles,
  Flexbox,
  Input,
  InputPassword,
  Spin,
  TextArea,
} from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { useMutation } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { type CredsApi } from '../useCredsApi';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-block-start: 24px;
  `,
  kvPair: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
  `,
}));

interface EditKVFormProps {
  cred: UserCredSummary;
  credsApi: CredsApi;
  onCancel: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  kvPairs: Array<{ key: string; value: string }>;
  name: string;
}

const EditKVForm: FC<EditKVFormProps> = ({ cred, credsApi, onCancel, onSuccess }) => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const form = useForm<FormValues>({ onSubmit: (values) => handleSubmit(values) });
  const [isLoading, setIsLoading] = useState(true);

  // Fetch decrypted values on mount
  useEffect(() => {
    const fetchDecryptedValues = async () => {
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
  }, [canManageCredentials, cred.id, cred.name, cred.description, credsApi, form]);

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!canManageCredentials) return;

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

      await credsApi.client.update.mutate({
        description: values.description,
        id: cred.id,
        name: values.name,
        values: valuesObj,
      });
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

      <Form.Field label={t('creds.form.values')}>
        <Form.List name="kvPairs">
          {({ fields, add, remove }) => (
            <Flexbox gap={8}>
              {fields.map(({ key, index }) => (
                <div className={styles.kvPair} key={key}>
                  <div style={{ flex: 1 }}>
                    <Form.Field bare name={`kvPairs.${index}.key`}>
                      <Input
                        disabled={!canManageCredentials}
                        placeholder={cred.type === 'kv-env' ? 'ENV_VAR_NAME' : 'Header-Name'}
                      />
                    </Form.Field>
                  </div>
                  <div style={{ flex: 2 }}>
                    <Form.Field bare name={`kvPairs.${index}.value`}>
                      <InputPassword
                        autoComplete="new-password"
                        disabled={!canManageCredentials}
                        placeholder={t('creds.form.valuePlaceholder')}
                      />
                    </Form.Field>
                  </div>
                  {fields.length > 1 && (
                    <Button
                      disabled={!canManageCredentials}
                      icon={Minus}
                      size="small"
                      type="text"
                      onClick={() => remove(index)}
                    />
                  )}
                </div>
              ))}
              <Button
                block
                disabled={!canManageCredentials}
                icon={Plus}
                type="dashed"
                onClick={() => add({ key: '', value: '' })}
              >
                {t('creds.form.addPair')}
              </Button>
            </Flexbox>
          )}
        </Form.List>
      </Form.Field>

      <Form.Field label={t('creds.form.description')} name="description">
        <TextArea
          disabled={!canManageCredentials}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Field>

      <div className={styles.footer}>
        <Button onClick={onCancel}>{t('creds.form.cancel')}</Button>
        <Button
          disabled={!canManageCredentials}
          htmlType="submit"
          loading={updateMutation.isPending}
          type="primary"
        >
          {t('creds.form.save')}
        </Button>
      </div>
    </Form>
  );
};

export default EditKVForm;
