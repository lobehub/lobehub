import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { GroupBotSquareIcon } from '@lobehub/ui/icons';
import { Command } from 'cmdk';
import { Bot, Image } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useCommandMenuContext } from './CommandMenuContext';
import { CommandItem } from './components';
import { styles } from './styles';
import { useCommandMenu } from './useCommandMenu';

const AskAIMenu = memo(() => {
  const { t } = useTranslation(['common', 'chat', 'home']);
  const navigate = useNavigate();
  const { handleAskLobeAI, handleAIPainting, closeCommandMenu } = useCommandMenu();
  const { search } = useCommandMenuContext();

  // Get agent list (limit to first 20 items for simplicity)
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);
  const agents = allAgents.filter((item) => item.type === 'agent').slice(0, 20);

  const heading = search.trim()
    ? t('cmdk.askAIHeading', { query: `"${search.trim()}"` })
    : t('cmdk.askAIHeadingEmpty');

  const handleAgentBuilder = () => {
    const trimmedSearch = search.trim();
    closeCommandMenu(); // Close immediately
    if (trimmedSearch) {
      // Use sendAsAgent to create a blank agent and open agent builder
      useHomeStore.getState().sendAsAgent(trimmedSearch);
    }
  };

  const handleGroupBuilder = () => {
    const trimmedSearch = search.trim();
    closeCommandMenu(); // Close immediately
    if (trimmedSearch) {
      // Use sendAsGroup to create a blank group and open group builder
      useHomeStore.getState().sendAsGroup(trimmedSearch);
    }
  };

  const handleAgentSelect = (agentId: string) => {
    if (search.trim()) {
      const message = encodeURIComponent(search.trim());
      navigate(`/agent/${agentId}?message=${message}`);
    } else {
      navigate(`/agent/${agentId}`);
    }
    closeCommandMenu();
  };

  return (
    <Command.Group heading={heading}>
      <Command.Item value="lobe-ai" onSelect={handleAskLobeAI}>
        <Avatar emojiScaleWithBackground avatar={DEFAULT_INBOX_AVATAR} shape="square" size={18} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>Lobe AI</div>
        </div>
      </Command.Item>
      <Command.Item value="agent-builder" onSelect={handleAgentBuilder}>
        <Bot className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('agentBuilder.title', { ns: 'chat' })}</div>
        </div>
      </Command.Item>
      <Command.Item value="group-builder" onSelect={handleGroupBuilder}>
        <GroupBotSquareIcon className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('starter.createGroup', { ns: 'home' })}</div>
        </div>
      </Command.Item>
      <Command.Item value="ai-painting" onSelect={handleAIPainting}>
        <Image className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('cmdk.aiPainting')}</div>
        </div>
      </Command.Item>

      {agents.map((agent) => (
        <CommandItem
          key={agent.id}
          title={agent.title || t('defaultAgent')}
          trailingLabel={t('cmdk.search.agent')}
          value={`agent-${agent.id}`}
          variant="detailed"
          icon={
            <Avatar
              emojiScaleWithBackground
              avatar={typeof agent.avatar === 'string' ? agent.avatar : DEFAULT_AVATAR}
              shape="square"
              size={18}
            />
          }
          onSelect={() => handleAgentSelect(agent.id)}
        />
      ))}
    </Command.Group>
  );
});

AskAIMenu.displayName = 'AskAIMenu';

export default AskAIMenu;
