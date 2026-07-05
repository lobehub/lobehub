'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Button, Form as AntdForm, Input } from 'antd';
import { LogIn } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

import type { PlatformCredentialExtrasProps } from '../types';

/**
 * Optional "log in with username + password" helper for Matrix. The password
 * is held only in local component state and exchanged for a long-lived access
 * token via `m.login.password`; only the resulting token + bot user ID are
 * written into the form. Operators who already have a token can ignore this
 * and paste the token directly.
 */
const CredentialExtras = memo<PlatformCredentialExtrasProps>(({ disabled }) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const { message } = App.useApp();
  const form = AntdForm.useFormInstance();
  const homeserverUrl = AntdForm.useWatch(['credentials', 'homeserverUrl'], form) as
    | string
    | undefined;

  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const matrixLogin = useAgentStore((s) => s.matrixLogin);

  const handleLogin = async () => {
    if (disabled) return;
    const hs = homeserverUrl?.trim();
    if (!hs) {
      message.warning(t('channel.matrix.loginMissingHomeserver'));
      return;
    }
    if (!user.trim() || !password) return;

    setLoading(true);
    try {
      const res = await matrixLogin({ homeserverUrl: hs, password, user: user.trim() });
      form.setFieldValue(['credentials', 'accessToken'], res.accessToken);
      form.setFieldValue('applicationId', res.userId);
      // Mark the auto-filled fields as real changes so Save enables.
      form.validateFields([['credentials', 'accessToken'], 'applicationId']).catch(() => undefined);
      // Clear the transient password from the UI once exchanged.
      setPassword('');
      message.success(t('channel.matrix.loginSuccess'));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      message.error(`${t('channel.matrix.loginFailed')}: ${text}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={8} style={{ marginBlockStart: 4 }}>
      <Flexbox horizontal gap={8}>
        <Input
          autoComplete="off"
          disabled={disabled || loading}
          placeholder={t('channel.matrix.loginUserPlaceholder')}
          size="small"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <Input.Password
          autoComplete="new-password"
          disabled={disabled || loading}
          placeholder={t('channel.matrix.loginPassword')}
          size="small"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Flexbox>
      <Button
        disabled={disabled || !user.trim() || !password || !homeserverUrl?.trim()}
        icon={<LogIn size={14} />}
        loading={loading}
        size="small"
        style={{ alignSelf: 'flex-start' }}
        type="default"
        onClick={handleLogin}
      >
        {t('channel.matrix.loginButton')}
      </Button>
    </Flexbox>
  );
});

export default CredentialExtras;
