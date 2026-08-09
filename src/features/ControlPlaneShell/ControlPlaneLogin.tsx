'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Form, Input } from 'antd';
import { ShieldIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aicoPanelStyles } from '@/features/AicoPanels';
import { signIn } from '@/libs/better-auth/auth-client';

interface LoginFormValues {
  email: string;
  password: string;
}

const ControlPlaneLogin = () => {
  const { t } = useTranslation('aico');
  const [form] = Form.useForm<LoginFormValues>();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const result = await signIn.email({
        callbackURL: '/',
        email: values.email.trim(),
        // Keep password as typed — special chars (% ^ :) must not be transformed.
        password: values.password,
      });

      if (result.error) {
        console.error('Control plane sign-in error', result.error);
        toast.error(result.error.message || t('platform.loginFailed'));
        return;
      }

      // Full reload so useSession + credentialed tRPC pick up the new cookie.
      window.location.reload();
    } catch (error) {
      console.error('Control plane sign-in failed', error);
      toast.error(t('platform.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox
      className={aicoPanelStyles.page}
      gap={16}
      style={{ maxWidth: 420, margin: '10vh auto' }}
    >
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <ShieldIcon size={20} />
          <Text strong as="h1" style={{ fontSize: 22, margin: 0 }}>
            {t('platform.loginTitle')}
          </Text>
        </Flexbox>
        <Text type="secondary">{t('platform.loginSubtitle')}</Text>
      </Flexbox>

      <Block className={aicoPanelStyles.section} variant="outlined">
        <Form form={form} layout="vertical" requiredMark={false} onFinish={onFinish}>
          <Form.Item
            label={t('platform.loginEmail')}
            name="email"
            rules={[{ required: true, type: 'email' }]}
          >
            <Input autoFocus autoComplete="username" size="large" type="email" />
          </Form.Item>
          <Form.Item
            label={t('platform.loginPassword')}
            name="password"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" size="large" />
          </Form.Item>
          <Button block htmlType="submit" loading={loading} type="primary">
            {t('platform.loginSubmit')}
          </Button>
        </Form>
      </Block>
    </Flexbox>
  );
};

export default ControlPlaneLogin;
