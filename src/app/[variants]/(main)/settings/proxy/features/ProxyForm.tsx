'use client';

import { type NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { type FormGroupItemType } from '@lobehub/ui';
import { Alert, Flexbox, Form, Icon, Skeleton } from '@lobehub/ui';
import { Button, Form as AntdForm, Input, Radio, Space, Switch } from 'antd';
import { Loader2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { desktopSettingsService } from '@/services/electron/settings';
import { useElectronStore } from '@/store/electron';

interface ProxyTestResult {
  message?: string;
  responseTime?: number;
  success: boolean;
}

const ProxyForm = () => {
  const { t } = useTranslation('electron');
  const [form] = Form.useForm();
  const [testUrl, setTestUrl] = useState('https://www.google.com');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loading, setLoading] = useState(false);

  const isEnableProxy = AntdForm.useWatch('enableProxy', form);
  const proxyRequireAuth = AntdForm.useWatch('proxyRequireAuth', form);

  const [setProxySettings, useGetProxySettings] = useElectronStore((s) => [
    s.setProxySettings,
    s.useGetProxySettings,
  ]);
  const { data: proxySettings, isLoading } = useGetProxySettings();

  useEffect(() => {
    if (proxySettings) {
      form.setFieldsValue(proxySettings);
      setHasUnsavedChanges(false);
    }
  }, [form, proxySettings]);

  // 监听表单变化
  const handleValuesChange = useCallback(() => {
    setLoading(true);
    setHasUnsavedChanges(true);
    setTestResult(null); // 清除之前的测试结果
    setLoading(false);
  }, []);

  // 保存配置
  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      const values = await form.validateFields();
      await setProxySettings(values);
      setHasUnsavedChanges(false);
    } catch {
      // validation error
    } finally {
      setIsSaving(false);
    }
  }, [form, setProxySettings]);

  // 重置配置
  const handleReset = useCallback(() => {
    if (proxySettings) {
      form.setFieldsValue(proxySettings);
      setHasUnsavedChanges(false);
      setTestResult(null);
    }
  }, [form, proxySettings]);

  // 测试代理配置
  const handleTest = useCallback(async () => {
    try {
      setIsTesting(true);
      setTestResult(null);

      // 验证表单并获取当前配置
      const values = await form.validateFields();
      const config: NetworkProxySettings = {
        ...proxySettings,
        ...values,
      };

      // 使用新的 testProxyConfig 方法测试用户正在配置的代理
      const result = await desktopSettingsService.testProxyConfig(config, testUrl);

      setTestResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: ProxyTestResult = {
        message: errorMessage,
        success: false,
      };
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  }, [proxySettings, testUrl, form]);

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
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
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
      },
      {
        children: <Input disabled={!isEnableProxy} placeholder="127.0.0.1" />,
        desc: t('proxy.validation.serverRequired'),
        label: t('proxy.server'),
        name: 'proxyServer',
      },
      {
        children: <Input disabled={!isEnableProxy} placeholder="7890" style={{ width: 120 }} />,
        desc: t('proxy.validation.portRequired'),
        label: t('proxy.port'),
        name: 'proxyPort',
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
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
            },
            {
              children: <Input.Password placeholder={t('proxy.password_placeholder')} />,
              label: t('proxy.password'),
              name: 'proxyPassword',
            },
          ]
        : []),
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('proxy.authSettings'),
  };

  const testGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Flexbox gap={8}>
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
            {/* 测试结果显示 */}
            {!testResult ? null : testResult.success ? (
              <Alert
                closable
                type={'success'}
                title={
                  <Flexbox horizontal align="center" gap={8}>
                    {t('proxy.testSuccessWithTime', { time: testResult.responseTime })}
                  </Flexbox>
                }
              />
            ) : (
              <Alert
                closable
                type={'error'}
                variant={'outlined'}
                title={
                  <Flexbox horizontal align="center" gap={8}>
                    {t('proxy.testFailed')}: {testResult.message}
                  </Flexbox>
                }
              />
            )}
          </Flexbox>
        ),
        desc: t('proxy.testDescription'),
        label: t('proxy.testUrl'),
        minWidth: undefined,
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('proxy.connectionTest'),
  };

  return (
    <Flexbox gap={24}>
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
      <Flexbox align="end" justify="flex-end">
        {hasUnsavedChanges && (
          <span style={{ color: 'var(--ant-color-warning)', marginBottom: 8 }}>
            {t('proxy.unsavedChanges')}
          </span>
        )}
        <Flexbox horizontal gap={8}>
          <Button
            disabled={!hasUnsavedChanges}
            loading={isSaving}
            type="primary"
            onClick={handleSave}
          >
            {t('proxy.saveButton')}
          </Button>
          <Button disabled={!hasUnsavedChanges || isSaving} onClick={handleReset}>
            {t('proxy.resetButton')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default ProxyForm;
