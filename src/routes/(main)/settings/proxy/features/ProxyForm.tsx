'use client';

import { type NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Skeleton, toast } from '@lobehub/ui';
import { Button, Form as AntdForm, Input, Radio, Space, Switch } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { desktopSettingsService } from '@/services/electron/settings';
import { useElectronStore } from '@/store/electron';

import SaveBar from './SaveBar';
import { useProxyDirty } from './useProxyDirty';

const PROXY_TYPES = ['http', 'https', 'socks5'] as const;
const IP_HOST_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN_HOST_REGEX = /^[\dA-Z](?:[\dA-Z-]*[\dA-Z])?(?:\.[\dA-Z](?:[\dA-Z-]*[\dA-Z])?)*$/i;

const isFormValidationError = (
  error: unknown,
): error is {
  errorFields: unknown[];
} => typeof error === 'object' && error !== null && 'errorFields' in error;

const isSupportedProxyType = (value?: string): value is (typeof PROXY_TYPES)[number] =>
  PROXY_TYPES.includes(value as (typeof PROXY_TYPES)[number]);

const isValidProxyHost = (host: string) => IP_HOST_REGEX.test(host) || DOMAIN_HOST_REGEX.test(host);

const isCompleteProxyConfig = (config: Partial<NetworkProxySettings>) => {
  if (!config.enableProxy) return true;
  if (!isSupportedProxyType(config.proxyType)) return false;

  const proxyServer = config.proxyServer?.trim();
  if (!proxyServer || !isValidProxyHost(proxyServer)) return false;

  const proxyPort = config.proxyPort?.trim();
  if (!proxyPort) return false;

  const port = Number.parseInt(proxyPort, 10);
  if (Number.isNaN(port) || port < 1 || port > 65_535) return false;

  if (config.proxyRequireAuth) {
    return Boolean(config.proxyUsername?.trim() && config.proxyPassword?.trim());
  }

  return true;
};

const ProxyForm = () => {
  const { t } = useTranslation('electron');
  const [form] = Form.useForm();
  const [testUrl, setTestUrl] = useState('https://www.google.com');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isEnableProxy = AntdForm.useWatch('enableProxy', form);
  const proxyRequireAuth = AntdForm.useWatch('proxyRequireAuth', form);

  const [setProxySettings, useGetProxySettings] = useElectronStore((s) => [
    s.setProxySettings,
    s.useGetProxySettings,
  ]);
  const { data: proxySettings, isLoading } = useGetProxySettings();

  const { isDirty } = useProxyDirty(form, proxySettings);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (proxySettings && !initializedRef.current) {
      form.setFieldsValue(proxySettings);
      initializedRef.current = true;
    }
  }, [form, proxySettings]);

  const validateProxyType = useCallback(
    async (_: unknown, value?: string) => {
      if (!isEnableProxy || isSupportedProxyType(value)) return;

      throw new Error(t('proxy.validation.typeRequired'));
    },
    [isEnableProxy, t],
  );

  const validateProxyServer = useCallback(
    async (_: unknown, value?: string) => {
      if (!isEnableProxy) return;

      const proxyServer = value?.trim();
      if (!proxyServer) {
        throw new Error(t('proxy.validation.serverRequired'));
      }

      if (!isValidProxyHost(proxyServer)) {
        throw new Error(t('proxy.validation.serverInvalid'));
      }
    },
    [isEnableProxy, t],
  );

  const validateProxyPort = useCallback(
    async (_: unknown, value?: string) => {
      if (!isEnableProxy) return;

      const proxyPort = value?.trim();
      if (!proxyPort) {
        throw new Error(t('proxy.validation.portRequired'));
      }

      const port = Number.parseInt(proxyPort, 10);
      if (Number.isNaN(port) || port < 1 || port > 65_535) {
        throw new Error(t('proxy.validation.portInvalid'));
      }
    },
    [isEnableProxy, t],
  );

  const validateProxyUsername = useCallback(
    async (_: unknown, value?: string) => {
      if (!isEnableProxy || !proxyRequireAuth || value?.trim()) return;

      throw new Error(t('proxy.validation.usernameRequired'));
    },
    [isEnableProxy, proxyRequireAuth, t],
  );

  const validateProxyPassword = useCallback(
    async (_: unknown, value?: string) => {
      if (!isEnableProxy || !proxyRequireAuth || value?.trim()) return;

      throw new Error(t('proxy.validation.passwordRequired'));
    },
    [isEnableProxy, proxyRequireAuth, t],
  );

  const handleValuesChange = useCallback(
    (changed: Partial<NetworkProxySettings>, allValues: NetworkProxySettings) => {
      if ('enableProxy' in changed) {
        const next = changed.enableProxy;

        if (next && !isCompleteProxyConfig(allValues)) return;

        const valuesToSave = next ? allValues : { enableProxy: false };
        setProxySettings(valuesToSave).catch((error) => {
          form.setFieldsValue({ enableProxy: !next });
          const message = error instanceof Error ? error.message : String(error);
          toast.error(t('proxy.saveFailed', { error: message }));
        });
      }
    },
    [form, setProxySettings, t],
  );

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      const values = await form.validateFields();
      await setProxySettings(values);
    } catch {
      // validation error
    } finally {
      setIsSaving(false);
    }
  }, [form, setProxySettings]);

  const handleReset = useCallback(() => {
    if (proxySettings) form.setFieldsValue(proxySettings);
  }, [form, proxySettings]);

  const handleTest = useCallback(async () => {
    try {
      setIsTesting(true);

      const values = await form.validateFields();
      const config: NetworkProxySettings = {
        ...proxySettings,
        ...values,
      };

      const result = await desktopSettingsService.testProxyConfig(config, testUrl);
      if (result.success) {
        toast.success(t('proxy.testSuccessWithTime', { time: result.responseTime }));
      } else {
        toast.error(`${t('proxy.testFailed')}: ${result.message ?? ''}`);
      }
    } catch (error) {
      if (isFormValidationError(error)) return;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`${t('proxy.testFailed')}: ${errorMessage}`);
    } finally {
      setIsTesting(false);
    }
  }, [proxySettings, testUrl, form, t]);

  if (isLoading) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const enableProxyGroup: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('proxy.enableDesc'),
        label: t('proxy.enable'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableProxy',
        valuePropName: 'checked',
      },
    ],
    title: t('proxy.enable'),
  };

  const basicSettingsGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Radio.Group disabled={!isEnableProxy}>
            <Radio value="http">HTTP</Radio>
            <Radio value="https">HTTPS</Radio>
            <Radio value="socks5">SOCKS5</Radio>
          </Radio.Group>
        ),
        label: t('proxy.type'),
        minWidth: undefined,
        name: 'proxyType',
        rules: [{ validator: validateProxyType }],
      },
      {
        children: <Input disabled={!isEnableProxy} placeholder="127.0.0.1" />,
        desc: t('proxy.validation.serverRequired'),
        label: t('proxy.server'),
        name: 'proxyServer',
        rules: [{ validator: validateProxyServer }],
      },
      {
        children: <Input disabled={!isEnableProxy} placeholder="7890" style={{ width: 120 }} />,
        desc: t('proxy.validation.portRequired'),
        label: t('proxy.port'),
        name: 'proxyPort',
        rules: [{ validator: validateProxyPort }],
      },
    ],
    title: t('proxy.basicSettings'),
  };

  const authGroup: FormGroupItemType = {
    children: [
      {
        children: <Switch disabled={!isEnableProxy} />,
        desc: t('proxy.authDesc'),
        label: t('proxy.auth'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'proxyRequireAuth',
        valuePropName: 'checked',
      },
      ...(proxyRequireAuth && isEnableProxy
        ? [
            {
              children: <Input placeholder={t('proxy.username_placeholder')} />,
              label: t('proxy.username'),
              name: 'proxyUsername',
              rules: [{ validator: validateProxyUsername }],
            },
            {
              children: <Input.Password placeholder={t('proxy.password_placeholder')} />,
              label: t('proxy.password'),
              name: 'proxyPassword',
              rules: [{ validator: validateProxyPassword }],
            },
          ]
        : []),
    ],
    title: t('proxy.authSettings'),
  };

  const testGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={t('proxy.testUrlPlaceholder')}
              style={{ flex: 1 }}
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
            />
            <Button loading={isTesting} type="default" onClick={handleTest}>
              {t('proxy.testButton')}
            </Button>
          </Space.Compact>
        ),
        desc: t('proxy.testDescription'),
        label: t('proxy.testUrl'),
        minWidth: undefined,
      },
    ],
    title: t('proxy.connectionTest'),
  };

  return (
    <>
      <Form
        collapsible={false}
        form={form}
        initialValues={proxySettings}
        items={[enableProxyGroup, basicSettingsGroup, authGroup, testGroup]}
        itemsType={'group'}
        variant={'filled'}
        onValuesChange={handleValuesChange}
        {...FORM_STYLE}
      />
      <SaveBar isDirty={isDirty} isSaving={isSaving} onReset={handleReset} onSave={handleSave} />
    </>
  );
};

export default ProxyForm;
