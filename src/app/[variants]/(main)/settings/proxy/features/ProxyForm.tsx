'use client';

import { type NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { Alert, Block, Flexbox, Skeleton, Text , Button } from '@lobehub/ui';
import { App, Divider, Form, Input, Radio, Space, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { message } = App.useApp();
  const [testUrl, setTestUrl] = useState('https://www.google.com');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const isEnableProxy = Form.useWatch('enableProxy', form);
  const proxyRequireAuth = Form.useWatch('proxyRequireAuth', form);

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
    setHasUnsavedChanges(true);
    setTestResult(null); // 清除之前的测试结果
  }, []);

  const updateFormValue = (value: any) => {
    const preValues = form.getFieldsValue();
    form.setFieldsValue(value);
    const newValues = form.getFieldsValue();
    if (isEqual(newValues, preValues)) return;

    handleValuesChange();
  };

  // 保存配置
  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      const values = await form.validateFields();
      await setProxySettings(values);
      setHasUnsavedChanges(false);
      message.success(t('proxy.saveSuccess'));
    } catch (error) {
      if (error instanceof Error) {
        message.error(t('proxy.saveFailed', { error: error.message }));
      }
    } finally {
      setIsSaving(false);
    }
  }, [form, t, message]);

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
      message.error(t('proxy.testFailed'));
    } finally {
      setIsTesting(false);
    }
  }, [proxySettings, testUrl]);

  if (isLoading) return <Skeleton />;

  return (
    <Form
      disabled={isSaving}
      form={form}
      layout="vertical"
      onValuesChange={handleValuesChange}
      requiredMark={false}
    >
      <Flexbox gap={24}>
        {/* 基本代理设置 */}
        <Block
          paddingBlock={16}
          paddingInline={24}
          style={{ borderRadius: 12 }}
          variant={'outlined'}
        >
          <Form.Item name="enableProxy" noStyle valuePropName="checked">
            <Flexbox align={'center'} horizontal justify={'space-between'}>
              <Flexbox>
                <Text as={'h4'}>{t('proxy.enable')}</Text>
                <Text type={'secondary'}>{t('proxy.enableDesc')}</Text>
              </Flexbox>
              <Switch
                checked={isEnableProxy}
                onChange={(checked) => {
                  updateFormValue({ enableProxy: checked });
                }}
              />
            </Flexbox>
          </Form.Item>
        </Block>

        {/* 认证设置 */}
        <Block
          paddingBlock={16}
          paddingInline={24}
          style={{ borderRadius: 12 }}
          variant={'outlined'}
        >
          <Flexbox gap={24}>
            <Flexbox>
              <Text as={'h4'}>{t('proxy.basicSettings')}</Text>
              <Text type={'secondary'}>{t('proxy.basicSettingsDesc')}</Text>
            </Flexbox>
            <Flexbox>
              <Form.Item
                dependencies={['enableProxy']}
                label={t('proxy.type')}
                name="proxyType"
                rules={[
                  ({ getFieldValue }) => ({
                    message: t('proxy.validation.typeRequired'),
                    required: getFieldValue('enableProxy'),
                  }),
                ]}
              >
                <Radio.Group disabled={!form.getFieldValue('enableProxy')}>
                  <Radio value="http">HTTP</Radio>
                  <Radio value="https">HTTPS</Radio>
                  <Radio value="socks5">SOCKS5</Radio>
                </Radio.Group>
              </Form.Item>

              <Space.Compact style={{ width: '100%' }}>
                <Form.Item
                  dependencies={['enableProxy']}
                  label={t('proxy.server')}
                  name="proxyServer"
                  rules={[
                    ({ getFieldValue }) => ({
                      message: t('proxy.validation.serverRequired'),
                      required: getFieldValue('enableProxy'),
                    }),
                    {
                      message: t('proxy.validation.serverInvalid'),
                      pattern:
                        /^((25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(25[0-5]|2[0-4]\d|[01]?\d{1,2})$|^[\dA-Za-z]([\dA-Za-z-]*[\dA-Za-z])?(\.[\dA-Za-z]([\dA-Za-z-]*[\dA-Za-z])?)*$/,
                    },
                  ]}
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <Input disabled={!form.getFieldValue('enableProxy')} placeholder="127.0.0.1" />
                </Form.Item>

                <Form.Item
                  dependencies={['enableProxy']}
                  label={t('proxy.port')}
                  name="proxyPort"
                  rules={[
                    ({ getFieldValue }) => ({
                      message: t('proxy.validation.portRequired'),
                      required: getFieldValue('enableProxy'),
                    }),
                    {
                      message: t('proxy.validation.portInvalid'),
                      pattern:
                        /^([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/,
                    },
                  ]}
                  style={{ marginBottom: 0, width: 120 }}
                >
                  <Input disabled={!form.getFieldValue('enableProxy')} placeholder="7890" />
                </Form.Item>
              </Space.Compact>
            </Flexbox>
            <Divider size={'small'} />
            <Flexbox gap={12}>
              <Form.Item
                dependencies={['enableProxy']}
                name="proxyRequireAuth"
                noStyle
                valuePropName="checked"
              >
                <Flexbox align={'center'} horizontal justify={'space-between'}>
                  <Flexbox>
                    <Text as={'h5'}>{t('proxy.auth')}</Text>
                    <Text type={'secondary'}>{t('proxy.authDesc')}</Text>
                  </Flexbox>
                  <Switch
                    checked={proxyRequireAuth}
                    disabled={!isEnableProxy}
                    onChange={(checked) => {
                      updateFormValue({ proxyRequireAuth: checked });
                    }}
                  />
                </Flexbox>
              </Form.Item>

              <Form.Item
                dependencies={['proxyRequireAuth', 'enableProxy']}
                label={t('proxy.username')}
                name="proxyUsername"
                rules={[
                  ({ getFieldValue }) => ({
                    message: t('proxy.validation.usernameRequired'),
                    required: getFieldValue('proxyRequireAuth') && getFieldValue('enableProxy'),
                  }),
                ]}
                style={{
                  display:
                    form.getFieldValue('proxyRequireAuth') && form.getFieldValue('enableProxy')
                      ? 'block'
                      : 'none',
                }}
              >
                <Input placeholder={t('proxy.username_placeholder')} />
              </Form.Item>

              <Form.Item
                dependencies={['proxyRequireAuth', 'enableProxy']}
                label={t('proxy.password')}
                name="proxyPassword"
                rules={[
                  ({ getFieldValue }) => ({
                    message: t('proxy.validation.passwordRequired'),
                    required: getFieldValue('proxyRequireAuth') && getFieldValue('enableProxy'),
                  }),
                ]}
                style={{
                  display:
                    form.getFieldValue('proxyRequireAuth') && form.getFieldValue('enableProxy')
                      ? 'block'
                      : 'none',
                }}
              >
                <Input.Password placeholder={t('proxy.password_placeholder')} />
              </Form.Item>
            </Flexbox>
          </Flexbox>
        </Block>

        {/* 连接测试 */}

        <Block
          paddingBlock={16}
          paddingInline={24}
          style={{ borderRadius: 12 }}
          variant={'outlined'}
        >
          <Flexbox gap={24}>
            <Flexbox>
              <Text as={'h4'}>{t('proxy.connectionTest')}</Text>
              <Text type={'secondary'}>{t('proxy.testDescription')}</Text>
            </Flexbox>
            <Form.Item label={t('proxy.testUrl')}>
              <Flexbox gap={8}>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    onChange={(e) => setTestUrl(e.target.value)}
                    placeholder={t('proxy.testUrlPlaceholder')}
                    style={{ flex: 1 }}
                    value={testUrl}
                  />
                  <Button loading={isTesting} onClick={handleTest} type="default">
                    {t('proxy.testButton')}
                  </Button>
                </Space.Compact>
                {/* 测试结果显示 */}
                {!testResult ? null : testResult.success ? (
                  <Alert
                    closable
                    title={
                      <Flexbox align="center" gap={8} horizontal>
                        {t('proxy.testSuccessWithTime', { time: testResult.responseTime })}
                      </Flexbox>
                    }
                    type={'success'}
                  />
                ) : (
                  <Alert
                    closable
                    title={
                      <Flexbox align="center" gap={8} horizontal>
                        {t('proxy.testFailed')}: {testResult.message}
                      </Flexbox>
                    }
                    type={'error'}
                    variant={'outlined'}
                  />
                )}
              </Flexbox>
            </Form.Item>
          </Flexbox>
        </Block>
        {/* 操作按钮 */}
        <Space>
          <Button
            disabled={!hasUnsavedChanges}
            loading={isSaving}
            onClick={handleSave}
            type="primary"
          >
            {t('proxy.saveButton')}
          </Button>

          <Button disabled={!hasUnsavedChanges || isSaving} onClick={handleReset}>
            {t('proxy.resetButton')}
          </Button>

          {hasUnsavedChanges && (
            <Text style={{ marginLeft: 8 }} type="warning">
              {t('proxy.unsavedChanges')}
            </Text>
          )}
        </Space>
      </Flexbox>
    </Form>
  );
};

export default ProxyForm;
