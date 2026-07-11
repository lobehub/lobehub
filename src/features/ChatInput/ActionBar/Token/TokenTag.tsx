import { ToolNameResolver } from '@lobechat/context-engine';
import { pluginPrompts } from '@lobechat/prompts';
import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { useUserStore } from '@/store/user';
import { settingsSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputStore } from '../../store';
import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';
import { getToolContextRefreshKey, getToolExcludeDefaultToolIds } from './utils';

const toolNameResolver = new ToolNameResolver();

const Token = memo(() => {
  const { t } = useTranslation(['chat', 'components']);

  const [input, contextWindowMessages] = useChatInputStore((s) => [
    s.markdownContent,
    s.contextWindowMessages,
  ]);
  const historySummary = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );

  const agentId = useAgentId();
  const [
    activeAgentId,
    systemRole,
    model,
    provider,
    enableAgentMode,
    searchMode,
    useModelBuiltinSearch,
    skillActivateMode,
    agentMemoryEnabled,
    runtimeMode,
    hasEnabledKnowledgeBases,
  ] = useAgentStore((s) => {
    const chatConfig = chatConfigByIdSelectors.getChatConfigById(agentId)(s);

    return [
      s.activeAgentId,
      agentByIdSelectors.getAgentSystemRoleById(agentId)(s),
      agentByIdSelectors.getAgentModelById(agentId)(s),
      agentByIdSelectors.getAgentModelProviderById(agentId)(s),
      chatConfig.enableAgentMode,
      chatConfig.searchMode,
      chatConfig.useModelBuiltinSearch,
      chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
      chatConfig.memory?.enabled,
      chatConfigByIdSelectors.getRuntimeModeById(agentId)(s),
      agentByIdSelectors
        .getAgentKnowledgeBasesById(agentId)(s)
        .some((item) => item.enabled),
    ];
  });
  const globalMemoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const effectiveMemoryEnabled = agentMemoryEnabled ?? globalMemoryEnabled;
  const [isProviderHasBuiltinSearch, isModelHasBuiltinSearch, isModelBuiltinSearchInternal] =
    useAiInfraStore((s) => [
      aiProviderSelectors.isProviderHasBuiltinSearch(provider)(s),
      aiModelSelectors.isModelHasBuiltinSearch(model, provider)(s),
      aiModelSelectors.isModelBuiltinSearchInternal(model, provider)(s),
    ]);
  const toolContextRefreshKey = getToolContextRefreshKey({
    agentId: activeAgentId || agentId,
    enableAgentMode,
    hasEnabledKnowledgeBases,
    isModelBuiltinSearchInternal,
    isModelHasBuiltinSearch,
    isProviderHasBuiltinSearch,
    memoryEnabled: effectiveMemoryEnabled,
    runtimeMode,
    searchMode,
    skillActivateMode,
    useModelBuiltinSearch,
  });

  const maxTokens = useModelContextWindowTokens(model, provider);

  // Tool usage token
  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  const toolsString = useToolStore(
    useCallback(() => {
      const toolsEngine = createAgentToolsEngine({ model, provider });

      const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
        excludeDefaultToolIds: getToolExcludeDefaultToolIds(skillActivateMode),
        model,
        provider,
        toolIds: pluginIds,
      });
      const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';

      // Generate plugin system roles from enabledManifests
      const toolsSystemRole =
        enabledManifests.length > 0
          ? pluginPrompts({
              tools: enabledManifests.map((manifest) => ({
                apis: manifest.api.map((api) => ({
                  desc: api.description,
                  name: toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
                })),
                identifier: manifest.identifier,
                name: pluginHelpers.getPluginTitle(manifest.meta) || manifest.identifier,
                systemRole: manifest.systemRole,
              })),
            })
          : '';

      return toolsSystemRole + schemaNumber;
      // toolContextRefreshKey tracks implicit createAgentToolsEngine inputs from other stores.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [model, pluginIds, provider, skillActivateMode, toolContextRefreshKey]),
  );

  const toolsToken = useTokenCount(canUseTool ? toolsString : '');

  // Chat usage token
  const inputTokenCount = useTokenCount(input);

  const messageString =
    contextWindowMessages
      ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('') || '';
  const chatsToken = useTokenCount(messageString) + inputTokenCount;

  // SystemRole token
  const systemRoleToken = useTokenCount(systemRole);
  const historySummaryToken = useTokenCount(historySummary);

  // Total token
  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;

  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  if (!isDevMode && maxTokens > 0 && totalToken / maxTokens <= 0.5) return null;

  const content = (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} width={'100%'}>
        <div style={{ color: cssVar.colorTextDescription }}>{t('tokenDetails.title')}</div>
        <Tooltip
          styles={{ root: { maxWidth: 'unset', pointerEvents: 'none' } }}
          title={t('ModelSelect.featureTag.tokens', {
            ns: 'components',
            tokens: numeral(maxTokens).format('0,0'),
          })}
        >
          <Center
            height={20}
            paddingInline={4}
            style={{
              background: cssVar.colorFillTertiary,
              borderRadius: 4,
              color: cssVar.colorTextSecondary,
              fontFamily: cssVar.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      {isDevMode && (
        <TokenProgress
          showIcon
          data={[
            {
              color: cssVar.magenta,
              id: 'systemRole',
              title: t('tokenDetails.systemRole'),
              value: systemRoleToken,
            },
            {
              color: cssVar.geekblue,
              id: 'tools',
              title: t('tokenDetails.tools'),
              value: toolsToken,
            },
            {
              color: cssVar.orange,
              id: 'historySummary',
              title: t('tokenDetails.historySummary'),
              value: historySummaryToken,
            },
            {
              color: cssVar.gold,
              id: 'chats',
              title: t('tokenDetails.chats'),
              value: chatsToken,
            },
          ]}
        />
      )}
      <TokenProgress
        showIcon={isDevMode}
        showTotal={t('tokenDetails.total')}
        data={[
          {
            color: cssVar.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: totalToken,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - totalToken,
          },
        ]}
      />
    </Flexbox>
  );

  return (
    <ActionPopover content={content}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        value={totalToken}
        size={{
          blockSize: 28,
          size: 18,
        }}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
      />
    </ActionPopover>
  );
});

export default Token;
