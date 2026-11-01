import { type LobeToolCustomPlugin } from '@lobechat/types';
import { Alert, Button, Divider, Flexbox, Input, InputPassword, RadioGroup } from '@lobehub/ui';
import { type FieldPath, Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyValueEditor from '@/components/KeyValueEditor';
import MCPStdioCommandInput from '@/components/MCPStdioCommandInput';
import ErrorDetails from '@/features/MCP/MCPInstallProgress/InstallError/ErrorDetails';
import { lambdaClient } from '@/libs/trpc/client';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';
import { type McpConnectionParams, type MCPErrorInfoMetadata } from '@/types/plugins';

import ArgsInput from './ArgsInput';
import CollapsibleSection from './CollapsibleSection';
import MCPTypeSelect from './MCPTypeSelect';
import QuickImportSection from './QuickImportSection';

interface MCPManifestFormProps {
  /**
   * Expose the OAuth auth type. Only the custom-connector entry sets this — the
   * OAuth flow is backed by the connector subsystem, so it must NOT show up for
   * the plain custom-plugin DevModal callers (editing plugins, agent tools, …).
   */
  enableOAuth?: boolean;
  form: FormInstance<LobeToolCustomPlugin>;
  isEditMode?: boolean;
  /**
   * Run the connector OAuth authorize flow. Called instead of the token-less
   * manifest test when the OAuth auth type is selected (testing an OAuth server
   * without authorizing first only ever 401s).
   */
  onAuthorizeOAuth?: () => void;
}

const HTTP_URL_KEY = 'customParams.mcp.url';
const STDIO_COMMAND = 'customParams.mcp.command';
const STDIO_ARGS = 'customParams.mcp.args';
const STDIO_ENV = 'customParams.mcp.env';
const MCP_TYPE = 'customParams.mcp.type';
const DESC_TYPE = 'customParams.description';
// Authentication-related constants
const AUTH_TYPE = 'customParams.mcp.auth.type';
const AUTH_TOKEN = 'customParams.mcp.auth.token';
const AUTH_CLIENT_ID = 'customParams.mcp.auth.clientId';
const AUTH_CLIENT_SECRET = 'customParams.mcp.auth.clientSecret';
// Headers-related constants
const HEADERS = 'customParams.mcp.headers';

const MCPManifestForm = ({
  form,
  isEditMode,
  enableOAuth,
  onAuthorizeOAuth,
}: MCPManifestFormProps) => {
  const { t } = useTranslation('plugin');
  const mcpType = useWatch(form, MCP_TYPE);
  const authType = useWatch(form, AUTH_TYPE);
  // For OAuth servers there is no token to test with — "testing" the connection
  // means running the authorize flow instead.
  const isOAuth = enableOAuth && mcpType === 'http' && authType === 'oauth2';

  // The redirect URI the server will use at authorize time (APP_URL-based), shown
  // so the user registers a matching URI on their OAuth app. Fetched lazily once
  // the OAuth auth type is in play.
  const [redirectUri, setRedirectUri] = useState('');
  useEffect(() => {
    if (!enableOAuth || authType !== 'oauth2' || redirectUri) return;
    lambdaClient.connector.getRedirectUri
      .query()
      .then((r) => setRedirectUri(r.redirectUri))
      .catch(() => {
        if (typeof window !== 'undefined') {
          setRedirectUri(`${window.location.origin}/oauth/connector/callback`);
        }
      });
  }, [enableOAuth, authType, redirectUri]);

  const pluginIds = useToolStore(pluginSelectors.storeAndInstallPluginsIdList);
  const [isTesting, setIsTesting] = useState(false);
  const testMcpConnection = useToolStore((s) => s.testMcpConnection);

  // Use identifier to track test state (if present in the form)
  const identifier = form.getValue('identifier') || 'temp-test-id';
  const testState = useToolStore(mcpStoreSelectors.getMCPConnectionTestState(identifier), isEqual);

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [errorMetadata, setErrorMetadata] = useState<MCPErrorInfoMetadata | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setConnectionError(null);
    setErrorMetadata(null);

    // Manually trigger validation for fields needed for the test
    const fieldsToValidate: FieldPath<LobeToolCustomPlugin>[] =
      mcpType === 'http' ? [HTTP_URL_KEY] : [STDIO_COMMAND, STDIO_ARGS];

    // For HTTP type, also validate authentication fields
    if (mcpType === 'http') {
      fieldsToValidate.push(AUTH_TYPE);
      const currentAuthType = form.getValue(AUTH_TYPE);
      if (currentAuthType === 'bearer') {
        fieldsToValidate.push(AUTH_TOKEN);
      }
    }

    const { valid } = await form.validate(fieldsToValidate);

    if (!valid) {
      setIsTesting(false);
      return;
    }

    try {
      const values = form.getValues();
      const id = values.identifier;
      const mcp = values.customParams?.mcp;
      const description = values.customParams?.description;
      const avatar = values.customParams?.avatar;

      // Use mcpStore's testMcpConnection method
      const result = await testMcpConnection({
        connection: mcp as McpConnectionParams['connection'],
        identifier: id,
        metadata: { avatar, description },
      });

      if (result.success && result.manifest) {
        // Optionally update form if manifest ID differs or to store the fetched manifest
        // Be careful about overwriting user input if not desired
        form.setValues({ manifest: result.manifest });
        setConnectionError(null); // Clear local error state
        setErrorMetadata(null);
      } else if (result.error) {
        // Store has already handled the error state; optionally show additional user-friendly messages here
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
          <Form.Field required label={t('dev.mcp.type.title')} name={MCP_TYPE}>
            <MCPTypeSelect />
          </Form.Field>
          <Form.Field
            desc={t('dev.mcp.identifier.desc')}
            label={t('dev.mcp.identifier.label')}
            name={'identifier'}
            required={t('dev.mcp.identifier.required')}
            tag={'identifier'}
            validate={(value?: string) => {
              if (!value) return;
              if (!/^[\w-]+$/.test(value)) return t('dev.mcp.identifier.invalid');
              if (!isEditMode && pluginIds.includes(value))
                return t('dev.meta.identifier.errorDuplicate');
            }}
          >
            <Input placeholder={t('dev.mcp.identifier.placeholder')} />
          </Form.Field>
          {mcpType === 'http' && (
            <>
              <Form.Field
                desc={t('dev.mcp.url.desc')}
                label={t('dev.mcp.url.label')}
                name={HTTP_URL_KEY}
                required={t('dev.mcp.url.required')}
                tag={'url'}
                validate={(value?: string) => {
                  if (!value) return;
                  try {
                    new URL(value);
                  } catch {
                    return t('dev.mcp.url.invalid');
                  }
                }}
              >
                <Input placeholder="https://mcp.higress.ai/mcp-github/xxxxx" />
              </Form.Field>
              <Form.Field
                desc={t('dev.mcp.auth.desc')}
                label={t('dev.mcp.auth.label')}
                name={AUTH_TYPE}
              >
                <RadioGroup
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
                    ...(enableOAuth
                      ? [
                          {
                            label: t('dev.mcp.auth.oauth'),
                            value: 'oauth2',
                          },
                        ]
                      : []),
                  ]}
                />
              </Form.Field>
              {authType === 'bearer' && (
                <Form.Field
                  desc={t('dev.mcp.auth.token.desc')}
                  label={t('dev.mcp.auth.token.label')}
                  name={AUTH_TOKEN}
                  required={t('dev.mcp.auth.token.required')}
                >
                  <InputPassword
                    autoComplete="new-password"
                    placeholder={t('dev.mcp.auth.token.placeholder')}
                  />
                </Form.Field>
              )}
              {enableOAuth && authType === 'oauth2' && (
                <>
                  <Form.Field
                    desc={t('dev.mcp.auth.oauth.clientId.desc')}
                    label={t('dev.mcp.auth.oauth.clientId.label')}
                    name={AUTH_CLIENT_ID}
                  >
                    <Input placeholder={t('dev.mcp.auth.oauth.clientId.placeholder')} />
                  </Form.Field>
                  <Form.Field
                    desc={t('dev.mcp.auth.oauth.clientSecret.desc')}
                    label={t('dev.mcp.auth.oauth.clientSecret.label')}
                    name={AUTH_CLIENT_SECRET}
                  >
                    <InputPassword
                      autoComplete="new-password"
                      placeholder={t('dev.mcp.auth.oauth.clientSecret.placeholder')}
                    />
                  </Form.Field>
                  <div
                    style={{
                      color: 'var(--lobe-colors-textDescription)',
                      fontSize: 12,
                      marginBottom: 8,
                    }}
                  >
                    {t('dev.mcp.auth.oauth.redirectHint')}
                    <br />
                    <code style={{ wordBreak: 'break-all' }}>{redirectUri}</code>
                  </div>
                </>
              )}
              <CollapsibleSection title={t('dev.mcp.advanced.title')}>
                <Form.Field
                  desc={t('dev.mcp.headers.desc')}
                  label={t('dev.mcp.headers.label')}
                  name={HEADERS}
                >
                  <KeyValueEditor addButtonText={t('dev.mcp.headers.add')} />
                </Form.Field>
              </CollapsibleSection>
            </>
          )}
          {mcpType === 'stdio' && (
            <>
              <Form.Field
                desc={t('dev.mcp.command.desc')}
                label={t('dev.mcp.command.label')}
                name={STDIO_COMMAND}
                required={t('dev.mcp.command.required')}
                tag={'command'}
              >
                <MCPStdioCommandInput
                  placeholder={t('dev.mcp.command.placeholder')}
                  onParsedArgs={(args) => {
                    const existing = form.getValue(STDIO_ARGS) ?? [];
                    form.setValue(STDIO_ARGS, [...args, ...existing.filter(Boolean)]);
                  }}
                />
              </Form.Field>
              <Form.Field
                desc={t('dev.mcp.args.desc')}
                label={t('dev.mcp.args.label')}
                name={STDIO_ARGS}
                required={t('dev.mcp.args.required')}
                tag={'args'}
              >
                <ArgsInput placeholder={t('dev.mcp.args.placeholder')} />
              </Form.Field>
              <Form.Field
                extra={t('dev.mcp.env.desc')}
                label={t('dev.mcp.env.label')}
                name={STDIO_ENV}
                tag={'env'}
              >
                <KeyValueEditor
                  addButtonText={t('dev.mcp.env.add')}
                  keyPlaceholder="VARIABLE_NAME"
                />
              </Form.Field>
            </>
          )}
          <Form.Field label={t('dev.mcp.testConnectionTip')} layout={'horizontal'}>
            <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
              <Button
                loading={isTesting}
                type={!!mcpType ? 'primary' : undefined}
                onClick={isOAuth ? onAuthorizeOAuth : handleTestConnection}
              >
                {isOAuth ? t('dev.mcp.auth.oauth.authorize') : t('dev.mcp.testConnection')}
              </Button>
            </Flexbox>
          </Form.Field>
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
          <Divider style={{ marginBlock: 24 }} />
          <Form.Field
            desc={t('dev.mcp.desc.desc')}
            label={t('dev.mcp.desc.label')}
            name={DESC_TYPE}
            tag={'description'}
          >
            <Input placeholder={t('dev.mcp.desc.placeholder')} />
          </Form.Field>
          <Form.Field label={t('dev.mcp.avatar.label')} name={'customParams.avatar'} tag={'avatar'}>
            <Input placeholder={'https://plugin-avatar.com'} />
          </Form.Field>
        </Flexbox>
      </Form>
    </>
  );
};

export default MCPManifestForm;
