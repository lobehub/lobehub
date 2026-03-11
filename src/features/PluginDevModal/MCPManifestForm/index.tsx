import { Alert, Button, Flexbox, FormItem, Input, InputPassword } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { Divider, Form, Radio } from 'antd';
import isEqual from 'fast-deep-equal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';
import MCPStdioCommandInput from '@/components/MCPStdioCommandInput';
import ErrorDetails from '@/features/MCP/MCPInstallProgress/InstallError/ErrorDetails';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { type MCPErrorInfoMetadata } from '@/types/plugins';

import ArgsInput from './ArgsInput';
import CollapsibleSection from './CollapsibleSection';
import MCPTypeSelect from './MCPTypeSelect';
import QuickImportSection from './QuickImportSection';

interface MCPManifestFormProps {
  form: FormInstance;
  isEditMode?: boolean;
}

const HTTP_URL_KEY = ['customParams', 'mcp', 'url'];
const STDIO_COMMAND = ['customParams', 'mcp', 'command'];
const STDIO_ARGS = ['customParams', 'mcp', 'args'];
const STDIO_ENV = ['customParams', 'mcp', 'env'];
const MCP_TYPE = ['customParams', 'mcp', 'type'];
const DESC_TYPE = ['customParams', 'description'];
// 新增认证相关常量
const AUTH_TYPE = ['customParams', 'mcp', 'auth', 'type'];
const AUTH_TOKEN = ['customParams', 'mcp', 'auth', 'token'];
// 新增 headers 相关常量
const HEADERS = ['customParams', 'mcp', 'headers'];

const MCPManifestForm = ({ form, isEditMode }: MCPManifestFormProps) => {
  const { t } = useTranslation('plugin');
  const mcpType = Form.useWatch(MCP_TYPE, form);
  const authType = Form.useWatch(AUTH_TYPE, form);

  const pluginIds = useToolStore(pluginSelectors.storeAndInstallPluginsIdList);
  const [isTesting, setIsTesting] = useState(false);
  const testMcpConnection = useToolStore((s) => s.testMcpConnection);

  // 使用 identifier 来跟踪测试状态（如果表单中有的话）
  const formValues = form.getFieldsValue();
  const identifier = formValues?.identifier || 'temp-test-id';
  const testState = useToolStore(mcpStoreSelectors.getMCPConnectionTestState(identifier), isEqual);

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [errorMetadata, setErrorMetadata] = useState<MCPErrorInfoMetadata | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setConnectionError(null);
    setErrorMetadata(null);

    // Manually trigger validation for fields needed for the test
    let isValid = false;
    try {
      const fieldsToValidate = [
        ...(mcpType === 'http' ? [HTTP_URL_KEY] : [STDIO_COMMAND, STDIO_ARGS]),
      ];

      // 如果是 HTTP 类型，还需要验证认证字段
      if (mcpType === 'http') {
        fieldsToValidate.push(AUTH_TYPE);
        const currentAuthType = form.getFieldValue(AUTH_TYPE);
        if (currentAuthType === 'bearer') {
          fieldsToValidate.push(AUTH_TOKEN);
        }
      }

      await form.validateFields(fieldsToValidate);
      isValid = true;
    } catch {
      // no-thing
    }

    if (!isValid) {
      setIsTesting(false);
      return;
    }

    try {
      const values = form.getFieldsValue();
      const id = values.identifier;
      const mcp = values.customParams?.mcp;
      const description = values.customParams?.description;
      const avatar = values.customParams?.avatar;

      // 使用 mcpStore 的 testMcpConnection 方法
      const result = await testMcpConnection({
        connection: mcp,
        identifier: id,
        metadata: { avatar, description },
      });

      if (result.success && result.manifest) {
        // Optionally update form if manifest ID differs or to store the fetched manifest
        // Be careful about overwriting user input if not desired
        form.setFieldsValue({ manifest: result.manifest });
        setConnectionError(null); // 清除本地错误状态
        setErrorMetadata(null);
      } else if (result.error) {
        // Store 已经处理了错误状态，这里可以选择显示额外的用户友好提示
        const errorMessage = t('error.testConnectionFailed', {
          error: result.error,
        });
        setConnectionError(errorMessage);

        // Build error metadata for detailed display
        if (result.errorLog || mcpType === 'stdio') {
          setErrorMetadata({
            errorLog: result.errorLog,
            params:
              mcpType === 'stdio'
                ? {
                    args: mcp?.args,
                    command: mcp?.command,
                    type: 'stdio',
                  }
                : undefined,
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      // Handle unexpected errors
      const err = error as Error;
      const errorMessage = t('error.testConnectionFailed', {
        error: err.message || t('unknownError'),
      });
      setConnectionError(errorMessage);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <>
      <QuickImportSection
        form={form}
        isEditMode={isEditMode}
        onClearConnectionError={() => {
          setConnectionError(null);
          setErrorMetadata(null);
        }}
      />
      <Form form={form} layout={'vertical'}>
        <Flexbox>
          <Form.Item
            initialValue={'http'}
            label={t('dev.mcp.type.title')}
            name={['customParams', 'mcp', 'type']}
            rules={[{ required: true }]}
          >
            <MCPTypeSelect />
          </Form.Item>
          <FormItem
            desc={t('dev.mcp.identifier.desc')}
            label={t('dev.mcp.identifier.label')}
            name={'identifier'}
            tag={'identifier'}
            rules={[
              { message: t('dev.mcp.identifier.required'), required: true },
              {
                message: t('dev.mcp.identifier.invalid'),
                pattern: /^[\w-]+$/,
              },
              isEditMode
                ? {}
                : {
                    message: t('dev.meta.identifier.errorDuplicate'),
                    validator: async () => {
                      const id = form.getFieldValue('identifier');
                      if (!id) return true;
                      if (pluginIds.includes(id)) {
                        throw new Error('Duplicate');
                      }
                    },
                  },
            ]}
          >
            <Input placeholder={t('dev.mcp.identifier.placeholder')} />
          </FormItem>
          {mcpType === 'http' && (
            <>
              <FormItem
                desc={t('dev.mcp.url.desc')}
                label={t('dev.mcp.url.label')}
                name={HTTP_URL_KEY}
                tag={'url'}
                rules={[
                  { message: t('dev.mcp.url.required'), required: true },
                  {
                    message: t('dev.mcp.url.invalid'),
                    validator: async (_, value) => {
                      if (!value) return true;

                      // 如果不是 URL 就会自动抛出错误
                      new URL(value);
                    },
                  },
                ]}
              >
                <Input placeholder="https://mcp.higress.ai/mcp-github/xxxxx" />
              </FormItem>
              <FormItem
                desc={t('dev.mcp.auth.desc')}
                initialValue={'none'}
                label={t('dev.mcp.auth.label')}
                name={AUTH_TYPE}
              >
                <Radio.Group
                  style={{ width: '100%' }}
                  options={[
                    {
                      label: t('dev.mcp.auth.none'),
                      value: 'none',
                    },
                    {
                      label: t('dev.mcp.auth.bear'),
                      value: 'bearer',
                    },
                  ]}
                />
              </FormItem>
              {authType === 'bearer' && (
                <FormItem
                  desc={t('dev.mcp.auth.token.desc')}
                  label={t('dev.mcp.auth.token.label')}
                  name={AUTH_TOKEN}
                  rules={[{ message: t('dev.mcp.auth.token.required'), required: true }]}
                >
                  <InputPassword placeholder={t('dev.mcp.auth.token.placeholder')} />
                </FormItem>
              )}
              <CollapsibleSection title={t('dev.mcp.advanced.title')}>
                <FormItem
                  desc={t('dev.mcp.headers.desc')}
                  label={t('dev.mcp.headers.label')}
                  name={HEADERS}
                >
                  <KeyValueEditor addButtonText={t('dev.mcp.headers.add')} />
                </FormItem>
              </CollapsibleSection>
            </>
          )}
          {mcpType === 'stdio' && (
            <>
              <FormItem
                desc={t('dev.mcp.command.desc')}
                label={t('dev.mcp.command.label')}
                name={STDIO_COMMAND}
                rules={[{ message: t('dev.mcp.command.required'), required: true }]}
                tag={'command'}
              >
                <MCPStdioCommandInput placeholder={t('dev.mcp.command.placeholder')} />
              </FormItem>
              <FormItem
                desc={t('dev.mcp.args.desc')}
                label={t('dev.mcp.args.label')}
                name={STDIO_ARGS}
                rules={[{ message: t('dev.mcp.args.required'), required: true }]}
                tag={'args'}
              >
                <ArgsInput placeholder={t('dev.mcp.args.placeholder')} />
              </FormItem>
              <FormItem
                extra={t('dev.mcp.env.desc')}
                label={t('dev.mcp.env.label')}
                name={STDIO_ENV}
                tag={'env'}
              >
                <KeyValueEditor
                  addButtonText={t('dev.mcp.env.add')}
                  keyPlaceholder="VARIABLE_NAME"
                />
              </FormItem>
            </>
          )}
          <FormItem colon={false} label={t('dev.mcp.testConnectionTip')} layout={'horizontal'}>
            <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
              <Button
                loading={isTesting}
                type={!!mcpType ? 'primary' : undefined}
                onClick={handleTestConnection}
              >
                {t('dev.mcp.testConnection')}
              </Button>
            </Flexbox>
          </FormItem>
          {(connectionError || testState.error) && (
            <Alert
              closable
              showIcon
              extra={errorMetadata ? <ErrorDetails errorInfo={errorMetadata} /> : undefined}
              title={connectionError || testState.error}
              type="error"
              onClose={() => {
                setConnectionError(null);
                setErrorMetadata(null);
              }}
            />
          )}
          <FormItem noStyle name={'manifest'} />
          <Divider />
          <FormItem
            desc={t('dev.mcp.desc.desc')}
            label={t('dev.mcp.desc.label')}
            name={DESC_TYPE}
            tag={'description'}
          >
            <Input placeholder={t('dev.mcp.desc.placeholder')} />
          </FormItem>
          <FormItem
            label={t('dev.mcp.avatar.label')}
            name={['customParams', 'avatar']}
            tag={'avatar'}
          >
            <Input placeholder={'https://plugin-avatar.com'} />
          </FormItem>
        </Flexbox>
      </Form>
    </>
  );
};

export default MCPManifestForm;
