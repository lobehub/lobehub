'use client';

import { Alert, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Button, Form, type FormInstance, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, Info, RefreshCw, Save, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';

import { type IntegrationProvider } from '../const';
import type { IntegrationFormValues, TestResult } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block-start: 32px;
  `,
  content: css`
    display: flex;
    flex-direction: column;
    gap: 24px;

    width: 100%;
    max-width: 800px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  helperLink: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorPrimary};
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  `,
  label: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  labelLeft: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
  `,
  sectionTitle: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-size: 12px;
    font-weight: 700;
    color: ${cssVar.colorTextQuaternary};

    &::before {
      content: '';

      display: block;

      width: 6px;
      height: 6px;
      border-radius: 50%;

      background: ${cssVar.colorPrimary};
    }
  `,
  webhookBox: css`
    overflow: hidden;
    flex: 1;

    height: ${cssVar.controlHeight};
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    font-family: monospace;
    font-size: 13px;
    line-height: ${cssVar.controlHeight};
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface BodyProps {
  form: FormInstance<IntegrationFormValues>;
  hasConfig: boolean;
  onCopied: () => void;
  onDelete: () => void;
  onSave: () => void;
  onTestConnection: () => void;
  provider: IntegrationProvider;
  saveResult?: TestResult;
  saving: boolean;
  testing: boolean;
  testResult?: TestResult;
}

const Body = memo<BodyProps>(
  ({
    provider,
    form,
    hasConfig,
    saveResult,
    saving,
    testing,
    testResult,
    onSave,
    onDelete,
    onTestConnection,
    onCopied,
  }) => {
    const { t } = useTranslation('agent');
    const origin = useAppOrigin();

    return (
      <Form component={false} form={form}>
        <div className={styles.content}>
          {/* Connection Config */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t('integration.connectionConfig')}</div>

            <div className={styles.field}>
              <div className={styles.label}>
                <div className={styles.labelLeft}>
                  {t('integration.applicationId')}
                  {provider.fieldTags.appId && <Tag>{provider.fieldTags.appId}</Tag>}
                </div>
              </div>
              <Form.Item noStyle name="applicationId" rules={[{ required: true }]}>
                <Input placeholder={t('integration.applicationIdPlaceholder')} />
              </Form.Item>
            </div>

            <div className={styles.field}>
              <div className={styles.label}>
                <div className={styles.labelLeft}>
                  {t('integration.botToken')}
                  {provider.fieldTags.token && <Tag>{provider.fieldTags.token}</Tag>}
                </div>
                <a
                  className={styles.helperLink}
                  href={provider.docsLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t('integration.botTokenHowToGet')} <Icon icon={ExternalLink} size={'small'} />
                </a>
              </div>
              <Form.Item noStyle name="botToken" rules={[{ required: true }]}>
                <Input.Password
                  style={{ fontFamily: 'monospace' }}
                  placeholder={
                    hasConfig
                      ? t('integration.botTokenPlaceholderExisting')
                      : t('integration.botTokenPlaceholderNew')
                  }
                />
              </Form.Item>
              <Text
                type="secondary"
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  fontSize: 12,
                  gap: 4,
                }}
              >
                <Icon icon={Info} size={'small'} /> {t('integration.botTokenEncryptedHint')}
              </Text>
            </div>

            {provider.fieldTags.publicKey && (
              <div className={styles.field}>
                <div className={styles.label}>
                  <div className={styles.labelLeft}>
                    {t('integration.publicKey')}
                    <Tag>{provider.fieldTags.publicKey}</Tag>
                  </div>
                </div>
                <Form.Item noStyle name="publicKey">
                  <Input
                    placeholder={t('integration.publicKeyPlaceholder')}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Item>
              </div>
            )}
          </div>

          {/* Action Bar */}
          <div className={styles.actionBar}>
            {hasConfig ? (
              <Button danger icon={<Trash2 size={16} />} type="text" onClick={onDelete}>
                {t('integration.removeIntegration')}
              </Button>
            ) : (
              <div />
            )}

            <Flexbox horizontal gap={12}>
              {hasConfig && (
                <Button icon={<RefreshCw size={16} />} loading={testing} onClick={onTestConnection}>
                  {t('integration.testConnection')}
                </Button>
              )}
              <Button icon={<Save size={16} />} loading={saving} type="primary" onClick={onSave}>
                {t('integration.save')}
              </Button>
            </Flexbox>
          </div>

          {saveResult && (
            <Alert
              closable
              showIcon
              description={saveResult.type === 'error' ? saveResult.errorDetail : undefined}
              type={saveResult.type}
              title={
                saveResult.type === 'success' ? t('integration.saved') : t('integration.saveFailed')
              }
            />
          )}

          {testResult && (
            <Alert
              closable
              showIcon
              description={testResult.type === 'error' ? testResult.errorDetail : undefined}
              type={testResult.type}
              title={
                testResult.type === 'success'
                  ? t('integration.testSuccess')
                  : t('integration.testFailed')
              }
            />
          )}

          {/* Endpoint URL - only shown after config is saved */}
          {hasConfig && (
            <div className={styles.field}>
              <div className={styles.label}>
                <div className={styles.labelLeft}>
                  {t('integration.endpointUrl')}
                  {provider.fieldTags.webhook && <Tag>{provider.fieldTags.webhook}</Tag>}
                </div>
              </div>
              <Flexbox horizontal gap={8}>
                <div className={styles.webhookBox}>
                  {`${origin}/api/agent/webhooks/${provider.id}`}
                </div>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(`${origin}/api/agent/webhooks/${provider.id}`);
                    onCopied();
                  }}
                >
                  {t('integration.copy')}
                </Button>
              </Flexbox>
              <Alert
                showIcon
                type="info"
                message={
                  <Trans
                    components={{ bold: <strong /> }}
                    i18nKey="integration.endpointUrlHint"
                    ns="agent"
                    values={{ name: provider.name }}
                  />
                }
              />
            </div>
          )}
        </div>
      </Form>
    );
  },
);

export default Body;
