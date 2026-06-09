'use client';

import { Button, Flexbox, Input } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { type Dayjs } from 'dayjs';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CreateApiKeyParams } from '@/types/apiKey';

import ApiKeyDatePicker from '../ApiKeyDatePicker';

type FormValues = Omit<CreateApiKeyParams, 'expiresAt'> & {
  expiresAt: Dayjs | null;
};

export interface ApiKeyModalContentProps {
  onSubmit: (values: CreateApiKeyParams) => Promise<void>;
}

const ApiKeyModalContent: FC<ApiKeyModalContentProps> = ({ onSubmit }) => {
  const { t } = useTranslation('auth');
  const { close } = useModalContext();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);

  const handleFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      await onSubmit({
        ...values,
        expiresAt: values.expiresAt ? values.expiresAt.toDate() : null,
      } satisfies CreateApiKeyParams);
      close();
    } finally {
      setLoading(false);
    }
  };

  const itemStyle = { marginBottom: 0 };

  return (
    <Form colon={false} form={form} layout={'vertical'} onFinish={handleFinish}>
      <Flexbox gap={16}>
        <Form.Item
          label={t('apikey.form.fields.name.label')}
          name={'name'}
          rules={[{ required: true }]}
          style={itemStyle}
        >
          <Input placeholder={t('apikey.form.fields.name.placeholder')} />
        </Form.Item>

        <Form.Item
          label={t('apikey.form.fields.expiresAt.label')}
          name={'expiresAt'}
          style={itemStyle}
        >
          <ApiKeyDatePicker style={{ width: '100%' }} />
        </Form.Item>

        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('apikey.form.submit')}
        </Button>
      </Flexbox>
    </Form>
  );
};

export default ApiKeyModalContent;
