'use client';

import { Button, createStaticStyles, Flexbox, Input, InputPassword, TextArea } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { useMutation } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

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

interface KVCredFormProps {
  credsApi: CredsApi;
  disabled?: boolean;
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

const KVCredForm: FC<KVCredFormProps> = ({ credsApi, type, disabled, onBack, onSuccess }) => {
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

  return (
    <Form form={form} layout="vertical">
      <Form.Field
        label={t('creds.form.key')}
        name="key"
        required={t('creds.form.keyRequired')}
        validate={(value?: string) =>
          value && !/^[\w-]+$/.test(value) ? t('creds.form.keyPattern') : undefined
        }
      >
        <Input disabled={disabled} placeholder="e.g., openai" />
      </Form.Field>

      <Form.Field label={t('creds.form.name')} name="name" required={t('creds.form.nameRequired')}>
        <Input disabled={disabled} placeholder="e.g., OpenAI API Key" />
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
                        disabled={disabled}
                        placeholder={type === 'kv-env' ? 'ENV_VAR_NAME' : 'Header-Name'}
                      />
                    </Form.Field>
                  </div>
                  <div style={{ flex: 2 }}>
                    <Form.Field bare name={`kvPairs.${index}.value`}>
                      <InputPassword
                        autoComplete="new-password"
                        disabled={disabled}
                        placeholder={t('creds.form.valuePlaceholder')}
                      />
                    </Form.Field>
                  </div>
                  {fields.length > 1 && (
                    <Button
                      disabled={disabled}
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
                disabled={disabled}
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
          disabled={disabled}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Field>

      <div className={styles.footer}>
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

export default KVCredForm;
