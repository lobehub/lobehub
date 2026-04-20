'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Form, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
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
}));

interface EditMetaFormProps {
  cred: UserCredSummary;
  onCancel: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  name: string;
}

const EditMetaForm: FC<EditMetaFormProps> = ({ cred, onCancel, onSuccess }) => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm<FormValues>();

  const updateMutation = useMutation({
    mutationFn: (values: FormValues) => {
      return lambdaClient.market.creds.update.mutate({
        description: values.description,
        id: cred.id,
        name: values.name,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (values: FormValues) => {
    updateMutation.mutate(values);
  };

  return (
    <Form<FormValues>
      form={form}
      layout="vertical"
      initialValues={{
        description: cred.description,
        name: cred.name,
      }}
      onFinish={handleSubmit}
    >
      <Form.Item
        label={t('creds.form.name')}
        name="name"
        rules={[{ required: true, message: t('creds.form.nameRequired') }]}
      >
        <Input />
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

export default EditMetaForm;
