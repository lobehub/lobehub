import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Avatar, preventDefault } from '@lobehub/ui';
import { Command } from 'cmdk';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors/builtinAgentSelectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useCommandMenuContext } from './CommandMenuContext';
import { styles } from './styles';

const AskAgentCommands = memo(() => {
  const { t } = useTranslation('common');
  const { search, setSearch, setSelectedAgent } = useCommandMenuContext();

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);

  // Check if search starts with "@"
  const isAtMention = search.trimStart().startsWith('@');

  // Get the query after "@" for filtering
  const mentionQuery = useMemo(() => {
    if (!isAtMention) return '';
    return search.trimStart().slice(1).toLowerCase();
  }, [search, isAtMention]);

  // Filter agents based on the query after "@"
  const filteredAgents = useMemo(() => {
    const agents = allAgents.filter((item) => item.type === 'agent');
    if (!mentionQuery) {
      return agents.slice(0, 10);
    }
    return agents
      .filter((agent) => {
        const title = (agent.title || '').toLowerCase();
        return title.includes(mentionQuery);
      })
      .slice(0, 10);
  }, [allAgents, mentionQuery]);

  const handleAgentSelect = (agentId: string, agentTitle: string, agentAvatar: string) => {
    setSelectedAgent({
      avatar: agentAvatar,
      id: agentId,
      title: agentTitle,
    });
    setSearch('');
  };

  // Only show when user types "@"
  if (!isAtMention) return null;

  // Check if Lobe AI matches the query
  const showLobeAI = !mentionQuery || 'lobe ai'.includes(mentionQuery);

  return (
    <Command.Group heading={t('cmdk.mentionAgent')}>
      {/* @Lobe AI option */}
      {showLobeAI && (
        <Command.Item
          value="@lobe-ai"
          onMouseDown={preventDefault}
          onSelect={() => handleAgentSelect(inboxAgentId, 'Lobe AI', DEFAULT_INBOX_AVATAR)}
        >
          <Avatar emojiScaleWithBackground avatar={DEFAULT_INBOX_AVATAR} shape="square" size={18} />
          <div className={styles.itemContent}>
            <div className={styles.itemLabel}>@Lobe AI</div>
          </div>
        </Command.Item>
      )}

      {/* @agent options */}
      {filteredAgents.map((agent) => (
        <Command.Item
          key={agent.id}
          value={`@${agent.title || 'agent'}-${agent.id}`}
          onMouseDown={preventDefault}
          onSelect={() =>
            handleAgentSelect(
              agent.id,
              agent.title || t('defaultAgent'),
              typeof agent.avatar === 'string' ? agent.avatar : DEFAULT_AVATAR,
            )
          }
        >
          <Avatar
            emojiScaleWithBackground
            avatar={typeof agent.avatar === 'string' ? agent.avatar : DEFAULT_AVATAR}
            shape="square"
            size={18}
          />
          <div className={styles.itemContent}>
            <div className={styles.itemLabel}>@{agent.title || t('defaultAgent')}</div>
          </div>
        </Command.Item>
      ))}
    </Command.Group>
  );
});

AskAgentCommands.displayName = 'AskAgentCommands';

export default AskAgentCommands;
