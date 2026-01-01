import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { Command } from 'cmdk';
import { Image } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useCommandMenuContext } from './CommandMenuContext';
import { styles } from './styles';
import { useCommandMenu } from './useCommandMenu';

const AskAIMenu = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { handleAskLobeAI, handleAIPainting, closeCommandMenu } = useCommandMenu();
  const { search } = useCommandMenuContext();

  // Get agent list (limit to first 20 items for simplicity)
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);
  const agents = allAgents.filter((item) => item.type === 'agent').slice(0, 20);

  const heading = search.trim()
    ? t('cmdk.askAIHeading', { query: `"${search.trim()}"` })
    : t('cmdk.askAIHeadingEmpty');

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
      <Command.Item onSelect={handleAskLobeAI} value="lobe-ai">
        <Avatar avatar={DEFAULT_INBOX_AVATAR} emojiScaleWithBackground shape="square" size={18} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>Lobe AI</div>
        </div>
      </Command.Item>
      <Command.Item onSelect={handleAIPainting} value="ai-painting">
        <Image className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('cmdk.aiPainting')}</div>
        </div>
      </Command.Item>

      {agents.map((agent) => (
        <Command.Item
          key={agent.id}
          onSelect={() => handleAgentSelect(agent.id)}
          value={`agent-${agent.id}`}
        >
          <Avatar
            avatar={typeof agent.avatar === 'string' ? agent.avatar : DEFAULT_AVATAR}
            emojiScaleWithBackground
            shape="square"
            size={18}
          />
          <div className={styles.itemContent}>
            <div className={styles.itemLabel}>{agent.title || t('defaultAgent')}</div>
          </div>
        </Command.Item>
      ))}
    </Command.Group>
  );
});

AskAIMenu.displayName = 'AskAIMenu';

export default AskAIMenu;
