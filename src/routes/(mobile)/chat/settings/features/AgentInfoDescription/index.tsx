'use client';

import { ProDescriptions } from '@ant-design/pro-components';
import { type AgentItemDetail } from '@lobehub/market-sdk';
import { Flexbox, Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';
import Image from '@/libs/next/Image';

interface AgentConfig {
  params?: {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
  };
}

interface ChatConfig {
  enableHistoryCount?: boolean;
  historyCount?: number;
  searchMode?: string;
}

interface TTSConfig {
  ttsService?: string;
  voice?: any;
}

interface AgentInfoDescriptionProps {
  agentConfig?: AgentConfig;
  chatConfig?: ChatConfig;
  files?: Array<{
    enabled?: boolean;
    id: string;
    name: string;
    type: string;
  }>;
  isRemote?: boolean;
  knowledgeBases?: Array<{
    enabled?: boolean;
    id: string;
    name: string;
  }>;
  meta?: Partial<AgentItemDetail> & {
    description?: string;
    name?: string;
    title?: string;
  };
  model?: string;
  plugins?: string[];
  provider?: string;
  systemRole?: string;
  ttsConfig?: TTSConfig;
}

const AgentInfoDescription = memo<AgentInfoDescriptionProps>(
  ({
    agentConfig,
    chatConfig,
    files = [],
    isRemote = false,
    knowledgeBases = [],
    meta,
    model,
    plugins = [],
    provider,
    systemRole,
    ttsConfig,
  }) => {
    const { t } = useTranslation('setting');
    // 转换远程数据格式
    const getProcessedData = () => {
      if (!isRemote || !meta) {
        return {
          agentConfig,
          chatConfig,
          files,
          knowledgeBases,
          meta,
          model,
          plugins,
          provider,
          systemRole,
          ttsConfig,
        };
      }

      // 远程数据格式转换
      const remoteData = meta;
      const config = remoteData.config || {};

      return {
        agentConfig: {
          params: config.model?.parameters || {},
        },
        chatConfig: config.chatConfig || {},
        files: config.files || [],
        knowledgeBases: config.knowledgeBases || [],
        meta: {
          avatar: remoteData?.avatar,
          description: remoteData?.description,
          name: remoteData?.versionName,
          tags: remoteData?.tags ? [remoteData.tags] : undefined,
          title: remoteData?.name,
        },
        model: config.model?.model,
        plugins: config.plugins?.map((p: any) => (typeof p === 'string' ? p : p.identifier)) || [],
        provider: config.model?.provider,
        systemRole: config.systemRole,
        ttsConfig: config.tts || {},
      };
    };

    const {
      agentConfig: processedAgentConfig,
      chatConfig: processedChatConfig,
      meta: processedMeta,
      model: processedModel,
      plugins: processedPlugins,
      provider: processedProvider,
      systemRole: processedSystemRole,
    } = getProcessedData();
    const unsetText = t('agentInfoDescription.value.unset');

    const unnamedText = t('agentInfoDescription.value.untitled');
    const pluginEmptyText = t('agentInfoDescription.plugins.empty');
    const renderAvatar = (avatar: string | undefined) => {
      if (!avatar) return unsetText;

      // 如果是 http 或 https 链接，显示图片
      if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
        return (
          <Image alt="avatar" height={40} src={avatar} style={{ borderRadius: '50%' }} width={40} />
        );
      }

      // 否则直接显示字符（emoji）
      return (
        <div
          style={{
            fontSize: '24px',
            height: 40,
            lineHeight: '40px',
            textAlign: 'center',
            width: 40,
          }}
        >
          {avatar}
        </div>
      );
    };

    return (
      <div style={{ height: '500px', overflow: 'auto' }}>
        <Flexbox gap={16}>
          {/* 基础信息 */}
          <ProDescriptions
            bordered
            column={2}
            size="small"
            title={t('agentInfoDescription.basic.title')}
            columns={[
              {
                dataIndex: 'title',
                key: 'title',
                title: t('agentInfoDescription.basic.name'),
              },
              {
                dataIndex: 'avatar',
                key: 'avatar',
                render: (_: any, record: any) => renderAvatar(record.avatar),
                title: t('agentInfoDescription.basic.avatar'),
              },
              {
                dataIndex: 'description',
                key: 'description',
                span: 2,
                title: t('agentInfoDescription.basic.description'),
              },
              {
                dataIndex: 'tags',
                key: 'tags',
                render: (_: any, record: any) => {
                  const tags = record.tags;
                  if (!tags || !tags.length) return unsetText;
                  return tags.map((tag: string, index: number) => (
                    <Tag color="blue" key={index}>
                      {tag}
                    </Tag>
                  ));
                },
                span: 2,
                title: t('agentInfoDescription.basic.tags'),
              },
            ]}
            dataSource={{
              avatar: processedMeta?.avatar || unsetText,
              description: processedMeta?.description || unsetText,
              tags: processedMeta?.tags?.length ? processedMeta.tags : undefined,
              title: processedMeta?.title || processedMeta?.name || unnamedText,
            }}
          />

          {/* 角色设定 */}
          <ProDescriptions
            bordered
            column={1}
            size="small"
            columns={[
              {
                dataIndex: 'systemRole',
                key: 'systemRole',
                render: (_: any, record: any) => {
                  const text = record.systemRole;
                  if (text === unsetText) return text;
                  return text;
                },
                title: t('agentInfoDescription.role.systemRole'),
              },
            ]}
            dataSource={{
              systemRole: processedSystemRole || unsetText,
            }}
            title={
              <Flexbox horizontal align={'center'} gap={8}>
                <span>{t('agentInfoDescription.role.title')}</span>
                <Tokens style={{ marginTop: 0 }} value={processedSystemRole || ''} />
              </Flexbox>
            }
          />

          {/* 模型设置 */}
          <ProDescriptions
            bordered
            column={2}
            size="small"
            title={t('agentInfoDescription.model.title')}
            columns={[
              {
                dataIndex: 'model',
                key: 'model',
                title: t('agentInfoDescription.model.model'),
              },
              {
                dataIndex: 'provider',
                key: 'provider',
                title: t('agentInfoDescription.model.provider'),
              },
              {
                dataIndex: 'temperature',
                key: 'temperature',
                title: t('agentInfoDescription.model.temperature'),
              },
              {
                dataIndex: 'topP',
                key: 'topP',
                title: 'Top P',
              },
              {
                dataIndex: 'maxTokens',
                key: 'maxTokens',
                span: 2,
                title: t('agentInfoDescription.model.maxTokens'),
              },
            ]}
            dataSource={{
              maxTokens: processedAgentConfig?.params?.max_tokens ?? unsetText,
              model: processedModel || unsetText,
              provider: processedProvider || unsetText,
              temperature: processedAgentConfig?.params?.temperature ?? unsetText,
              topP: processedAgentConfig?.params?.top_p ?? unsetText,
            }}
          />

          {/* 聊天偏好 */}
          <ProDescriptions
            bordered
            column={2}
            size="small"
            title={t('agentInfoDescription.chat.title')}
            columns={[
              {
                dataIndex: 'historyCount',
                key: 'historyCount',
                title: t('agentInfoDescription.chat.historyCount'),
              },
              {
                dataIndex: 'enableHistoryCount',
                key: 'enableHistoryCount',
                title: t('agentInfoDescription.chat.enableHistoryCount'),
              },
              {
                dataIndex: 'searchMode',
                key: 'searchMode',
                title: t('agentInfoDescription.chat.searchMode'),
              },
            ]}
            dataSource={{
              enableHistoryCount: processedChatConfig?.enableHistoryCount
                ? t('agentInfoDescription.chat.yes')
                : t('agentInfoDescription.chat.no'),
              historyCount: processedChatConfig?.historyCount ?? unsetText,
              searchMode: processedChatConfig?.searchMode || unsetText,
            }}
          />

          <ProDescriptions
            bordered
            column={1}
            size="small"
            columns={[
              {
                dataIndex: 'plugins',
                key: 'plugins',
                render: (_: any, record: any) => {
                  const pluginList = record.plugins;
                  if (!pluginList?.length) return pluginEmptyText;
                  return pluginList.map((plugin: string, index: number) => (
                    <Tag color="green" key={index}>
                      {plugin}
                    </Tag>
                  ));
                },
                title: t('agentInfoDescription.plugins.title'),
              },
            ]}
            dataSource={{
              plugins: processedPlugins?.length ? processedPlugins : [],
            }}
            title={t('agentInfoDescription.plugins.count', {
              count: processedPlugins?.length || 0,
            })}
          />
        </Flexbox>
      </div>
    );
  },
);

export default AgentInfoDescription;
