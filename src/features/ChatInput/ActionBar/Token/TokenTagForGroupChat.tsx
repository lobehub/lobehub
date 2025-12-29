import { GroupMemberInfo, groupChatPrompts, groupSupervisorPrompts } from '@lobechat/prompts';
import { Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { useTheme } from 'antd-style';
import numeral from 'numeral';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { chatGroupSelectors } from '@/store/chatGroup/selectors';
import { useChatGroupStore } from '@/store/chatGroup/store';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { userProfileSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';

interface TokenTagForGroupChatProps {
  total: string;
}

const TokenTagForGroupChat = memo<TokenTagForGroupChatProps>(({ total: messageString }) => {
  const { t } = useTranslation(['chat', 'components']);
  const theme = useTheme();

  const input = useChatStore((s) => s.inputMessage);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  const [model, provider] = useAgentStore((s) => {
    return [
      agentSelectors.currentAgentModel(s) as string,
      agentSelectors.currentAgentModelProvider(s) as string,
    ];
  });

  // Group chat specific data
  const groupAgents = useSessionStore(sessionSelectors.currentGroupAgents);
  const activeSessionId = useSessionStore((s) => s.activeId);
  const groupConfig = useChatGroupStore(chatGroupSelectors.currentGroupConfig);
  const supervisorTodos = useChatStore((s) =>
    activeSessionId ? s.supervisorTodos[messageMapKey(activeSessionId, activeTopicId)] || [] : [],
  );

  const maxTokens = useModelContextWindowTokens(model, provider);

  // Tool usage token - collect all plugins from all agents in the group
  const canUseTool = useModelSupportToolUse(model, provider);
  const allGroupPlugins = useMemo(() => {
    if (!groupAgents || groupAgents.length === 0) return [];

    // Collect unique plugins from all group agents
    const pluginSet = new Set<string>();
    groupAgents.forEach((agent) => {
      if (agent.plugins) {
        agent.plugins.forEach((plugin) => pluginSet.add(plugin));
      }
    });

    return Array.from(pluginSet);
  }, [groupAgents]);

  //@ts-ignore
  const pluginIds = allGroupPlugins.map((plugin) => plugin.id);

  const toolsString = useToolStore((s) => {
    const toolsEngine = createAgentToolsEngine({ model, provider });

    const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
      model,
      provider,
      toolIds: pluginIds,
    });
    const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';

    const pluginSystemRoles = toolSelectors.enabledSystemRoles(enabledToolIds)(s);

    return pluginSystemRoles + schemaNumber;
  });
  const toolsToken = useTokenCount(canUseTool ? toolsString : '');

  // System role token calculation for group chat
  // Calculate the tokens for system message + user message that are sent per agent response
  const systemRolePerAgentString = useMemo(() => {
    if (!groupAgents || groupAgents.length === 0) return '';

    try {
      const chats = chatSelectors.mainAIChatsWithHistoryConfig(useChatStore.getState());

      // Get real user name from user store
      const userStoreState = getUserStoreState();
      const realUserName = userProfileSelectors.nickName(userStoreState) || 'User';

      const agentTitleMap: GroupMemberInfo[] = [
        { id: 'user', title: realUserName },
        ...(groupAgents || []).map((agent) => ({ id: agent.id || '', title: agent.title || '' })),
      ];

      // Calculate tokens for a representative agent's system prompt and user instruction
      const firstAgent = groupAgents[0];
      if (!firstAgent) return '';

      const baseSystemRole = firstAgent.systemRole || '';
      const members: GroupMemberInfo[] = agentTitleMap as GroupMemberInfo[];

      // Build the group chat system prompt (same as used in agent processing)
      const groupChatSystemPrompt = groupChatPrompts.buildGroupChatSystemPrompt({
        agentId: firstAgent.id || '',
        baseSystemRole,
        groupMembers: members,
        messages: chats,
      });

      // Build the user message (instruction for agent to respond)
      const userInstruction = `Now it's your turn to respond. You are sending message to the group publicly. Please respond as this agent would, considering the full conversation history provided above. Directly return the message content, no other text. You do not need add author name or anything else.`;

      // Return combined system + user message tokens
      return groupChatSystemPrompt + '\n\n' + userInstruction;
    } catch (error) {
      console.warn('Failed to calculate system role tokens:', error);
      return '';
    }
  }, [groupAgents, messageString]);

  const systemRoleToken = useTokenCount(systemRolePerAgentString);

  // Supervisor token calculation for group chat
  const supervisorPrompt = useMemo(() => {
    if (!groupAgents || groupAgents.length === 0) {
      return '';
    }

    try {
      const chats = chatSelectors.mainAIChatsWithHistoryConfig(useChatStore.getState());

      // Only calculate supervisor tokens if there are actual messages in the conversation
      if (!chats || chats.length === 0) {
        return '';
      }

      const conversationHistory = groupSupervisorPrompts(chats);

      // Get real user name from user store
      const userStoreState = getUserStoreState();
      const realUserName = userProfileSelectors.nickName(userStoreState) || 'User';

      return groupChatPrompts.buildSupervisorPrompt({
        availableAgents: groupAgents
          .filter((agent) => agent.id)
          .map((agent) => ({ id: agent.id!, title: agent.title })),
        conversationHistory,
        systemPrompt: groupConfig.systemPrompt,
        todoList: supervisorTodos,
        userName: realUserName,
      });
    } catch (error) {
      console.warn('Failed to calculate supervisor tokens:', error);
      return '';
    }
  }, [groupAgents, groupConfig.systemPrompt, messageString, supervisorTodos]);

  const supervisorToken = useTokenCount(supervisorPrompt);

  // Chat usage token
  const inputTokenCount = useTokenCount(input);

  const chatsString = useMemo(() => {
    return chatSelectors.mainAIChatsMessageString(useChatStore.getState());
  }, [messageString]);

  const chatsToken = useTokenCount(chatsString) + inputTokenCount;

  // Total token (include supervisor tokens and system role tokens for group chat)
  const totalToken = systemRoleToken + toolsToken + chatsToken + supervisorToken;

  const content = (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox align={'center'} gap={4} horizontal justify={'space-between'} width={'100%'}>
        <div style={{ color: theme.colorTextDescription }}>{t('tokenDetails.title')}</div>
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
              background: theme.colorFillTertiary,
              borderRadius: 4,
              color: theme.colorTextSecondary,
              fontFamily: theme.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      <TokenProgress
        data={[
          {
            color: theme.magenta,
            id: 'systemRole',
            title: t('tokenDetails.systemRole'),
            value: systemRoleToken,
          },
          {
            color: theme.geekblue,
            id: 'tools',
            title: t('tokenDetails.tools'),
            value: toolsToken,
          },
          ...(supervisorToken > 0
            ? [
                {
                  color: theme.purple,
                  id: 'supervisor',
                  title: t('tokenDetails.supervisor'),
                  value: supervisorToken,
                },
              ]
            : []),
          {
            color: theme.gold,
            id: 'chats',
            title: t('tokenDetails.chats'),
            value: chatsToken,
          },
        ]}
        showIcon
      />
      <TokenProgress
        data={[
          {
            color: theme.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: totalToken,
          },
          {
            color: theme.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - totalToken,
          },
        ]}
        showIcon
        showTotal={t('tokenDetails.total')}
      />
    </Flexbox>
  );

  return (
    <ActionPopover content={content}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        style={{ marginLeft: 8 }}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
        value={totalToken}
      />
    </ActionPopover>
  );
});

TokenTagForGroupChat.displayName = 'TokenTagForGroupChat';

export default TokenTagForGroupChat;
