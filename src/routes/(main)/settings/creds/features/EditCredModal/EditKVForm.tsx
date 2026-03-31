'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Form, Input, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Minus, Plus } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

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
  onCancel: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  kvPairs: Array<{ key: string; value: string }>;
  name: string;
}

const EditKVForm: FC<EditKVFormProps> = ({ cred, onCancel, onSuccess }) => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm<FormValues>();
  const [isLoading, setIsLoading] = useState(true);

  // Fetch decrypted values on mount
  useEffect(() => {
    const fetchDecryptedValues = async () => {
      try {
        const result = await lambdaClient.market.creds.get.query({
          decrypt: true,
          id: cred.id,
        });

        // Convert values object to array of key-value pairs
        const values = (result as any).values || {};
        const kvPairs = Object.entries(values).map(([key, value]) => ({
          key,
          value: value as string,
        }));

        form.setFieldsValue({
          description: cred.description,
          kvPairs: kvPairs.length > 0 ? kvPairs : [{ key: '', value: '' }],
          name: cred.name,
        });
      } catch {
        // If decryption fails, just show empty values
        form.setFieldsValue({
          description: cred.description,
          kvPairs: [{ key: '', value: '' }],
          name: cred.name,
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchDecryptedValues();
  }, [cred.id, cred.name, cred.description, form]);

  const updateMutation = useMutation({
    mutationFn: (values: FormValues) => {
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

      return lambdaClient.market.creds.update.mutate({
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
    <Form<FormValues> form={form} layout="vertical" onFinish={handleSubmit}>
      <Form.Item
        label={t('creds.form.name')}
        name="name"
        rules={[{ required: true, message: t('creds.form.nameRequired') }]}
      >
        <Input />
      </Form.Item>

      <Form.Item label={t('creds.form.values')}>
        <Form.List name="kvPairs">
          {(fields, { add, remove }) => (
            <Flexbox gap={8}>
              {fields.map(({ key, name, ...restField }) => (
                <div className={styles.kvPair} key={key}>
                  <Form.Item
                    {...restField}
                    name={[name, 'key']}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input placeholder={cred.type === 'kv-env' ? 'ENV_VAR_NAME' : 'Header-Name'} />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, 'value']}
                    style={{ flex: 2, marginBottom: 0 }}
                  >
                    <Input.Password placeholder={t('creds.form.valuePlaceholder')} />
                  </Form.Item>
                  {fields.length > 1 && (
                    <Button icon={Minus} size="small" type="text" onClick={() => remove(name)} />
                  )}
                </div>
              ))}
              <Button block icon={Plus} type="dashed" onClick={() => add({ key: '', value: '' })}>
                {t('creds.form.addPair')}
              </Button>
            </Flexbox>
          )}
        </Form.List>
      </Form.Item>

      <Form.Item label={t('creds.form.description')} name="description">
        <Input.TextArea placeholder={t('creds.form.descriptionPlaceholder')} rows={2} />
      </Form.Item>

      <div className={styles.footer}>
        <Button onClick={onCancel}>{t('creds.form.cancel')}</Button>
        <Button htmlType="submit" loading={updateMutation.isPending} type="primary">
          {t('creds.form.save')}
        </Button>
      </div>
    </Form>
  );
};

export default EditKVForm;
