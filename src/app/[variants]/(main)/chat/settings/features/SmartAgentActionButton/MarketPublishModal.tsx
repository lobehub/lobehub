'use client';

import { ModalForm, ProFormText } from '@ant-design/pro-components';
import { AgentItemDetail } from '@lobehub/market-sdk';
import { type ModalProps } from '@lobehub/ui';
import { Col, Row, Spin } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useSessionStore } from '@/store/session';
import { sessionMetaSelectors } from '@/store/session/selectors';

import AgentInfoDescription from '../AgentInfoDescription';
import PublishResultModal from '../PublishResultModal';

export type MarketPublishAction = 'submit' | 'upload';

interface MarketPublishModalProps extends ModalProps {
  action: MarketPublishAction;
  onSuccess?: () => void;
}

interface MarketPublishFormValues {
  changelog: string;
  identifier?: string;
}

const MarketPublishModal = memo<MarketPublishModalProps>(
  ({ action, open, onCancel, onSuccess }) => {
    const { t } = useTranslation('setting');
    const isSubmit = action === 'submit';
    const isUpload = action === 'upload';

    const marketAuth = useMarketAuth();
    const { isAuthenticated } = marketAuth;
    const meta = useSessionStore(sessionMetaSelectors.currentAgentMeta, isEqual);
    const updateSessionMeta = useSessionStore((s) => s.updateSessionMeta);

    const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
    const language = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const agentConfig = useAgentStore(agentSelectors.currentAgentConfig);
    const chatConfig = useAgentStore(agentChatConfigSelectors.currentChatConfig);
    const plugins = useAgentStore(agentSelectors.currentAgentPlugins);
    const ttsConfig = useAgentStore(agentSelectors.currentAgentTTS);
    const model = useAgentStore(agentSelectors.currentAgentModel);
    const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
    const knowledgeBases = useAgentStore(agentSelectors.currentAgentKnowledgeBases);
    const files = useAgentStore(agentSelectors.currentAgentFiles);

    const [remoteAgentData, setRemoteAgentData] = useState<
      (AgentItemDetail & { description?: string; name?: string; title?: string }) | null
    >(null);
    const [loadingRemoteData, setLoadingRemoteData] = useState(false);
    const [showResultModal, setShowResultModal] = useState(false);
    const [publishResult, setPublishResult] = useState<{ identifier?: string }>({});

    const messageKey = isSubmit ? 'submit' : 'upload-version';
    const loadingMessage = isSubmit
      ? t('marketPublish.modal.loading.submit')
      : t('marketPublish.modal.loading.upload');
    const submitButtonText = t('marketPublish.modal.submitButton');
    const modalTitle = isSubmit
      ? t('marketPublish.modal.title.submit')
      : t('marketPublish.modal.title.upload');

    useEffect(() => {
      if (!isUpload) return;
      const marketIdentifier = meta?.marketIdentifier;
      const accessToken = marketAuth.getAccessToken();
      if (!open || !isAuthenticated || !accessToken || !marketIdentifier) return;

      let cancelled = false;

      const run = async () => {
        try {
          setLoadingRemoteData(true);
          marketApiService.setAccessToken(accessToken);
          const data = await marketApiService.getAgentDetail(marketIdentifier);
          if (!cancelled) {
            console.log('data', data);
            setRemoteAgentData(data);
          }
        } catch (error) {
          console.error('Failed to fetch remote agent data:', error);
          if (!cancelled) {
            message.error(t('marketPublish.modal.messages.fetchRemoteFailed'));
          }
        } finally {
          if (!cancelled) {
            setLoadingRemoteData(false);
          }
        }
      };

      void run();

      return () => {
        cancelled = true;
      };
    }, [isAuthenticated, isUpload, marketAuth, meta?.marketIdentifier, open]);

    const tokenUsage = useTokenCount(systemRole);

    const handleSubmit = useCallback(
      async (values: MarketPublishFormValues) => {
        const accessToken = marketAuth.getAccessToken();
        if (!isAuthenticated || !accessToken) {
          message.error(t('marketPublish.modal.messages.notAuthenticated'));
          return false;
        }

        const changelog = values.changelog?.trim();
        if (!changelog) {
          message.error({ content: t('marketPublish.modal.changelog.required'), key: messageKey });
          return false;
        }

        let identifier = meta?.marketIdentifier;

        try {
          message.loading({ content: loadingMessage, key: messageKey });
          marketApiService.setAccessToken(accessToken);

          if (isSubmit) {
            identifier = values.identifier?.trim();
            if (!identifier) {
              message.error({
                content: t('marketPublish.modal.identifier.required'),
                key: messageKey,
              });
              return false;
            }

            try {
              await marketApiService.getAgentDetail(identifier);
            } catch {
              const createPayload = {
                identifier,
                name: meta?.title || '',
              };
              await marketApiService.createAgent(createPayload);
            }
          } else if (!identifier) {
            message.error({
              content: t('marketPublish.modal.messages.missingIdentifier'),
              key: messageKey,
            });
            return false;
          }

          const versionPayload = {
            avatar: meta?.avatar,
            changelog,
            config: {
              chatConfig: {
                displayMode: chatConfig?.displayMode,
                enableHistoryCount: chatConfig?.enableHistoryCount,
                historyCount: chatConfig?.historyCount,
                maxTokens: agentConfig?.params?.max_tokens,
                searchMode: chatConfig?.searchMode,
                temperature: agentConfig?.params?.temperature,
                topP: agentConfig?.params?.top_p,
              },
              description: meta?.description,
              locale: language,
              model: {
                model,
                parameters: agentConfig?.params,
                provider,
              },
              plugins:
                plugins?.map((plugin) => {
                  if (typeof plugin === 'string') {
                    return plugin;
                  } else {
                    return null;
                  }
                }) || [],
              systemRole: systemRole,
            },
            description: meta?.description || '',
            identifier: identifier,
            name: meta?.title || '',
            tags: meta?.tags,
            tokenUsage: tokenUsage,
          };

          try {
            await marketApiService.createAgentVersion(versionPayload);
          } catch (versionError) {
            const errorMessage = versionError instanceof Error ? versionError.message : '未知错误';
            message.error({
              content: t('marketPublish.modal.messages.createVersionFailed', {
                message: errorMessage,
              }),
              key: messageKey,
            });
            return false;
          }

          if (isSubmit) {
            updateSessionMeta({ marketIdentifier: identifier });
          }

          setPublishResult({ identifier });
          setShowResultModal(true);

          message.destroy(messageKey);
          onSuccess?.();
          return true;
        } catch (error) {
          console.error('Market publish failed:', error);
          const errorMessage = error instanceof Error ? error.message : '发布失败';
          message.error({
            content: t('marketPublish.modal.messages.publishFailed', { message: errorMessage }),
            key: messageKey,
          });
          return false;
        }
      },
      [
        agentConfig?.params,
        chatConfig?.displayMode,
        chatConfig?.enableHistoryCount,
        chatConfig?.historyCount,
        chatConfig?.searchMode,
        isAuthenticated,
        isSubmit,
        language,
        marketAuth,
        meta?.avatar,
        meta?.description,
        meta?.marketIdentifier,
        meta?.tags,
        meta?.title,
        messageKey,
        loadingMessage,
        model,
        onSuccess,
        plugins,
        provider,
        systemRole,
        tokenUsage,
        updateSessionMeta,
      ],
    );

    return (
      <>
        <ModalForm<MarketPublishFormValues>
          modalProps={{
            bodyStyle: { height: '70vh', overflow: 'auto' },
            destroyOnClose: true,
            onCancel,
            style: { minWidth: 750 },
          }}
          onFinish={handleSubmit}
          open={open}
          submitter={{
            resetButtonProps: {
              style: { display: 'none' },
            },
            submitButtonProps: {
              children: submitButtonText,
            },
          }}
          title={modalTitle}
          width="80vw"
        >
          {isSubmit && (
            <ProFormText
              extra={t('marketPublish.modal.identifier.extra')}
              label={t('marketPublish.modal.identifier.label')}
              name="identifier"
              placeholder={t('marketPublish.modal.identifier.placeholder')}
              rules={[
                { message: t('marketPublish.modal.identifier.required'), required: true },
                {
                  message: t('marketPublish.modal.identifier.patternError'),
                  pattern: /^[\da-z-]+$/,
                },
                { max: 50, message: t('marketPublish.modal.identifier.lengthError'), min: 3 },
              ]}
            />
          )}

          <ProFormText
            extra={t('marketPublish.modal.changelog.extra')}
            label={t('marketPublish.modal.changelog.label')}
            name="changelog"
            placeholder={t('marketPublish.modal.changelog.placeholder')}
            rules={[
              { message: t('marketPublish.modal.changelog.required'), required: true },
              { max: 500, message: t('marketPublish.modal.changelog.maxLengthError') },
            ]}
          />

          {isUpload ? (
            <Row gutter={24}>
              <Col span={12}>
                <div style={{ border: '1px solid #d9d9d9', borderRadius: '6px', padding: '16px' }}>
                  <h3 style={{ marginBottom: '16px', textAlign: 'center' }}>
                    {t('marketPublish.modal.comparison.remote')}
                  </h3>
                  {loadingRemoteData ? (
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                      <Spin size="large" />
                      <div style={{ marginTop: '16px' }}>
                        {t('marketPublish.modal.loading.fetchingRemote')}
                      </div>
                    </div>
                  ) : (
                    <AgentInfoDescription isRemote={true} meta={remoteAgentData || undefined} />
                  )}
                </div>
              </Col>
              <Col span={12}>
                <div style={{ border: '1px solid #d9d9d9', borderRadius: '6px', padding: '16px' }}>
                  <h3 style={{ marginBottom: '16px', textAlign: 'center' }}>
                    {t('marketPublish.modal.comparison.local')}
                  </h3>
                  <AgentInfoDescription
                    agentConfig={agentConfig}
                    chatConfig={chatConfig}
                    files={files}
                    knowledgeBases={knowledgeBases}
                    meta={meta}
                    model={model}
                    plugins={plugins}
                    provider={provider}
                    systemRole={systemRole}
                    ttsConfig={ttsConfig}
                  />
                </div>
              </Col>
            </Row>
          ) : (
            <div style={{ marginTop: 24 }}>
              <AgentInfoDescription
                agentConfig={agentConfig}
                chatConfig={chatConfig}
                files={files}
                knowledgeBases={knowledgeBases}
                meta={meta}
                model={model}
                plugins={plugins}
                provider={provider}
                systemRole={systemRole}
                ttsConfig={ttsConfig}
              />
            </div>
          )}
        </ModalForm>

        <PublishResultModal
          identifier={publishResult.identifier}
          onCancel={() => setShowResultModal(false)}
          open={showResultModal}
        />
      </>
    );
  },
);

MarketPublishModal.displayName = 'MarketPublishModal';

export default MarketPublishModal;
