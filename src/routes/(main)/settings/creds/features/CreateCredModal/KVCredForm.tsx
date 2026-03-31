'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Form, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Minus, Plus } from 'lucide-react';
import { type FC } from 'react';
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

interface KVCredFormProps {
  onBack: () => void;
  onSuccess: () => void;
  type: 'kv-env' | 'kv-header';
}

interface FormValues {
  description?: string;
  key: string;
  kvPairs: Array<{ key: string; value: string }>;
  name: string;
}

const KVCredForm: FC<KVCredFormProps> = ({ type, onBack, onSuccess }) => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm<FormValues>();

  const createMutation = useMutation({
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

      return lambdaClient.market.creds.createKV.mutate({
        description: values.description,
        key: values.key,
        name: values.name,
        type,
        values: valuesObj,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (values: FormValues) => {
    createMutation.mutate(values);
  };

  return (
    <Form<FormValues>
      form={form}
      initialValues={{ kvPairs: [{ key: '', value: '' }] }}
      layout="vertical"
      onFinish={handleSubmit}
    >
      <Form.Item
        label={t('creds.form.key')}
        name="key"
        rules={[
          { required: true, message: t('creds.form.keyRequired') },
          { pattern: /^[\w-]+$/, message: t('creds.form.keyPattern') },
        ]}
      >
        <Input placeholder="e.g., openai" />
      </Form.Item>

      <Form.Item
        label={t('creds.form.name')}
        name="name"
        rules={[{ required: true, message: t('creds.form.nameRequired') }]}
      >
        <Input placeholder="e.g., OpenAI API Key" />
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
                    <Input placeholder={type === 'kv-env' ? 'ENV_VAR_NAME' : 'Header-Name'} />
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
        <Button onClick={onBack}>{t('creds.form.back')}</Button>
        <Button htmlType="submit" loading={createMutation.isPending} type="primary">
          {t('creds.form.submit')}
        </Button>
      </div>
    </Form>
  );
};

export default KVCredForm;
