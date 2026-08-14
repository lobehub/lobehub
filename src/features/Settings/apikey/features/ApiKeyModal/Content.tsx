'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { type Dayjs } from 'dayjs';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { API_KEY_FULL_ACCESS_SCOPE, type ApiKeyScope } from '@/const/apiKeyScope';
import { type CreateApiKeyParams } from '@/types/apiKey';

import ApiKeyDatePicker from '../ApiKeyDatePicker';
import ScopeSelector from './ScopeSelector';

type FormValues = Omit<CreateApiKeyParams, 'expiresAt' | 'scopes'> & {
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
  const [fullAccess, setFullAccess] = useState(true);
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([]);

  const scopeMissing = !fullAccess && selectedScopes.length === 0;

  const handleFinish = async (values: FormValues) => {
    if (scopeMissing) return;

    setLoading(true);
    try {
      await onSubmit({
        ...values,
        expiresAt: values.expiresAt ? values.expiresAt.toDate() : null,
        scopes: fullAccess ? [API_KEY_FULL_ACCESS_SCOPE] : selectedScopes,
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

        <Form.Item
          help={scopeMissing ? t('apikey.form.fields.scopes.required') : undefined}
          label={t('apikey.form.fields.scopes.label')}
          style={itemStyle}
          validateStatus={scopeMissing ? 'error' : undefined}
        >
          <ScopeSelector
            fullAccess={fullAccess}
            selected={selectedScopes}
            onFullAccessChange={setFullAccess}
            onSelectedChange={setSelectedScopes}
          />
        </Form.Item>

        <Button
          block
          disabled={scopeMissing}
          htmlType={'submit'}
          loading={loading}
          type={'primary'}
        >
          {t('apikey.form.submit')}
        </Button>
      </Flexbox>
    </Form>
  );
};

export default ApiKeyModalContent;
