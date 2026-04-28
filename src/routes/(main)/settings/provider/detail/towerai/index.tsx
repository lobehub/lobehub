'use client';

import { Alert, Button, Form, Input } from 'antd';
import { TowerAIProviderCard } from 'model-bank/modelProviders';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';

import { towerAIService } from '@/services/towerai';

import ProviderDetail from '../default';

const TowerAIAutoLogin = memo(() => {
  const { t } = useTranslation('modelProvider');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const handleLogin = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      setStatus(null);
      await towerAIService.login({
        password: values.password,
        username: values.username,
      });
      setStatus({ message: t('towerai.login.success', 'Login successful — token acquired'), type: 'success' });
    } catch (e: any) {
      setStatus({ message: e.message || 'Login failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!isDesktop) return null;

  return (
    <Flexbox gap={12} style={{ background: 'var(--lobe-colorBgContainer)', borderRadius: 8, padding: 16 }}>
      <strong>{t('towerai.autoLogin.title', 'Auto Login (OA SSO)')}</strong>
      <Form form={form} layout="vertical">
        <Form.Item label={t('towerai.username.title', 'Enterprise Email')} name="username" rules={[{ required: true }]}>
          <Input placeholder="your@company.com" type="email" />
        </Form.Item>
        <Form.Item label={t('towerai.password.title', 'Password')} name="password" rules={[{ required: true }]}>
          <Input.Password placeholder={t('towerai.password.placeholder', 'Enter password')} />
        </Form.Item>
        <Button loading={loading} onClick={handleLogin} type="primary">
          {t('towerai.login.button', 'Login & Fetch Token')}
        </Button>
      </Form>
      {status && <Alert message={status.message} showIcon type={status.type} />}
    </Flexbox>
  );
});

const Page = memo(() => (
  <Flexbox gap={24}>
    <ProviderDetail {...TowerAIProviderCard} />
    <TowerAIAutoLogin />
  </Flexbox>
));

export default Page;
