'use client';

import { type NetworkProxySettings } from '@lobechat/electron-client-ipc';
import {
  Button,
  Flexbox,
  Input,
  InputPassword,
  RadioGroup,
  Skeleton,
  Switch,
  toast,
} from '@lobehub/ui';
import { Form, type FormGroupItem, useForm, useWatch } from '@lobehub/ui/form';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { desktopSettingsService } from '@/services/electron/settings';
import { useElectronStore } from '@/store/electron';

import SaveBar from './SaveBar';
import { useProxyDirty } from './useProxyDirty';

const PROXY_TYPES = ['http', 'https', 'socks5'] as const;
const IP_HOST_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN_HOST_REGEX = /^[\dA-Z](?:[\dA-Z-]*[\dA-Z])?(?:\.[\dA-Z](?:[\dA-Z-]*[\dA-Z])?)*$/i;

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
  const [testUrl, setTestUrl] = useState('https://www.google.com');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [setProxySettings, useGetProxySettings] = useElectronStore((s) => [
    s.setProxySettings,
    s.useGetProxySettings,
  ]);
  const { data: proxySettings, isLoading } = useGetProxySettings();

  const form = useForm<NetworkProxySettings>({
    initialValues: proxySettings,
    onValuesChange: (changed, values) => handleValuesChange(changed, values),
  });

  const isEnableProxy = useWatch(form, 'enableProxy');
  const proxyRequireAuth = useWatch(form, 'proxyRequireAuth');

  const { isDirty } = useProxyDirty(form, proxySettings);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (proxySettings && !initializedRef.current) {
      form.setValues(proxySettings);
      initializedRef.current = true;
    }
  }, [form, proxySettings]);

  const validateProxyType = useCallback(
    (value?: string) => {
      if (!isEnableProxy || isSupportedProxyType(value)) return;

      return t('proxy.validation.typeRequired');
    },
    [isEnableProxy, t],
  );

  const validateProxyServer = useCallback(
    (value?: string) => {
      if (!isEnableProxy) return;

      const proxyServer = value?.trim();
      if (!proxyServer) return t('proxy.validation.serverRequired');

      if (!isValidProxyHost(proxyServer)) return t('proxy.validation.serverInvalid');
    },
    [isEnableProxy, t],
  );

  const validateProxyPort = useCallback(
    (value?: string) => {
      if (!isEnableProxy) return;

      const proxyPort = value?.trim();
      if (!proxyPort) return t('proxy.validation.portRequired');

      const port = Number.parseInt(proxyPort, 10);
      if (Number.isNaN(port) || port < 1 || port > 65_535) return t('proxy.validation.portInvalid');
    },
    [isEnableProxy, t],
  );

  const validateProxyUsername = useCallback(
    (value?: string) => {
      if (!isEnableProxy || !proxyRequireAuth || value?.trim()) return;

      return t('proxy.validation.usernameRequired');
    },
    [isEnableProxy, proxyRequireAuth, t],
  );

  const validateProxyPassword = useCallback(
    (value?: string) => {
      if (!isEnableProxy || !proxyRequireAuth || value?.trim()) return;

      return t('proxy.validation.passwordRequired');
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
          form.setValue('enableProxy', !next);
          const message = error instanceof Error ? error.message : String(error);
          toast.error(t('proxy.saveFailed', { error: message }));
        });
      }
    },
    [form, setProxySettings, t],
  );

  const handleSave = useCallback(async () => {
    const { valid } = await form.validate();
    // Validation error — fields surface their own inline messages.
    if (!valid) return;
    const values = form.getValues();

    try {
      setIsSaving(true);
      await setProxySettings(values);
      toast.success(t('proxy.saveSuccess'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t('proxy.saveFailed', { error: message }));
    } finally {
      setIsSaving(false);
    }
  }, [form, setProxySettings, t]);

  const handleReset = useCallback(() => {
    if (proxySettings) form.reset(proxySettings);
  }, [form, proxySettings]);

  const handleTest = useCallback(async () => {
    try {
      setIsTesting(true);

      const { valid } = await form.validate();
      if (!valid) return;
      const values = form.getValues();
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`${t('proxy.testFailed')}: ${errorMessage}`);
    } finally {
      setIsTesting(false);
    }
  }, [proxySettings, testUrl, form, t]);

  if (isLoading) return <Skeleton.Text rows={5} />;

  const enableProxyGroup: FormGroupItem<NetworkProxySettings> = {
    children: [
      {
        children: <Switch />,
        desc: t('proxy.enableDesc'),
        label: <SettingsSearchAnchor id={'proxy-enable'}>{t('proxy.enable')}</SettingsSearchAnchor>,
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enableProxy',
      },
    ],
    title: t('proxy.enable'),
  };

  const basicSettingsGroup: FormGroupItem<NetworkProxySettings> = {
    children: [
      {
        children: (
          <RadioGroup
            disabled={!isEnableProxy}
            options={PROXY_TYPES.map((type) => ({ label: type.toUpperCase(), value: type }))}
          />
        ),
        label: t('proxy.type'),
        minWidth: undefined,
        name: 'proxyType',
        validate: validateProxyType,
      },
      {
        children: <Input disabled={!isEnableProxy} placeholder="127.0.0.1" />,
        desc: t('proxy.validation.serverRequired'),
        label: t('proxy.server'),
        name: 'proxyServer',
        validate: validateProxyServer,
      },
      {
        children: <Input disabled={!isEnableProxy} placeholder="7890" style={{ width: 120 }} />,
        desc: t('proxy.validation.portRequired'),
        label: t('proxy.port'),
        name: 'proxyPort',
        validate: validateProxyPort,
      },
    ],
    title: t('proxy.basicSettings'),
  };

  const authGroup: FormGroupItem<NetworkProxySettings> = {
    children: [
      {
        children: <Switch disabled={!isEnableProxy} />,
        desc: t('proxy.authDesc'),
        label: <SettingsSearchAnchor id={'proxy-auth'}>{t('proxy.auth')}</SettingsSearchAnchor>,
        layout: 'horizontal',
        minWidth: undefined,
        name: 'proxyRequireAuth',
      },
      ...(proxyRequireAuth && isEnableProxy
        ? [
            {
              children: <Input placeholder={t('proxy.username_placeholder')} />,
              label: t('proxy.username'),
              name: 'proxyUsername' as const,
              validate: validateProxyUsername,
            },
            {
              children: (
                <InputPassword
                  autoComplete="new-password"
                  placeholder={t('proxy.password_placeholder')}
                />
              ),
              label: t('proxy.password'),
              name: 'proxyPassword' as const,
              validate: validateProxyPassword,
            },
          ]
        : []),
    ],
    title: t('proxy.authSettings'),
  };

  const testGroup: FormGroupItem<NetworkProxySettings> = {
    children: [
      {
        children: (
          <Flexbox horizontal align={'center'} gap={8} width={'100%'}>
            <Input
              placeholder={t('proxy.testUrlPlaceholder')}
              style={{ flex: 1 }}
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
            />
            <Button loading={isTesting} type="default" onClick={handleTest}>
              {t('proxy.testButton')}
            </Button>
          </Flexbox>
        ),
        desc: t('proxy.testDescription'),
        label: <SettingsSearchAnchor id={'proxy-test'}>{t('proxy.testUrl')}</SettingsSearchAnchor>,
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
        items={[enableProxyGroup, basicSettingsGroup, authGroup, testGroup]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
      <SaveBar isDirty={isDirty} isSaving={isSaving} onReset={handleReset} onSave={handleSave} />
    </>
  );
};

export default ProxyForm;
