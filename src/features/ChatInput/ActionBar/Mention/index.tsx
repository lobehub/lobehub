import { type ItemType } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui';
import { AtSign } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMentionStore } from '@/store/mention';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { type LobeGroupSession } from '@/types/session';

import Action from '../components/Action';

const Mention = memo(() => {
  const { t } = useTranslation('chat');
  const addMentionedUser = useMentionStore((s: any) => s.addMentionedUser);

  const handleMemberSelect = (agentId: string) => {
    addMentionedUser(agentId);
  };

  const useMentionItems = () => {
    const currentSession = useSessionStore(sessionSelectors.currentSession) as LobeGroupSession;

    const items: ItemType[] = useMemo(() => {
      const memberItems: ItemType[] = [];

      currentSession.members?.forEach((agent) => {
        memberItems.push({
          icon: (
            <Avatar
              avatar={agent.avatar}
              background={agent.backgroundColor ?? undefined}
              shape={'square'}
              size={24}
            />
          ),
          key: agent.id,
          label: agent.title || agent.id,
          onClick: () => handleMemberSelect(agent.id),
        });
      });

      return memberItems;
    }, [currentSession]);

    return items;
  };

  const items = useMentionItems();

  // Only show for group sessions
  if (!items.length) return null;

  return (
    <Action
      icon={AtSign}
      title={t('mention.title')}
      dropdown={{
        maxHeight: 320,
        menu: { items },
        minWidth: 200,
      }}
    />
  );
});

export default Mention;
