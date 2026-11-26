import { CHANNEL_URL } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { ActionIcon, copyToClipboard, DropdownMenu, toast } from '@lobehub/ui';
import { ArrowRight, Copy } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { channelActions } from '@/store/channel';

import type { SkillAgent } from './useSkillAgents';

/** The message: the skill as a composer chip (`<skill … />`), then the ask. */
export const skillPrompt = (identifier: string, name: string, ask: string) =>
  `<skill name="${identifier}" label="${name.replaceAll('"', "'")}" /> ${ask}`;

interface SkillPromptSendProps {
  /** Assistants that have the skill switched on. */
  agents: SkillAgent[];
  identifier: string;
  name: string;
}

/**
 * The button at the end of the skill page's mock chat box. With no assistant
 * running the skill it copies the message; with one it sends it to that
 * assistant's conversation; with several it asks which one first.
 */
const SkillPromptSend = memo<SkillPromptSendProps>(({ agents, identifier, name }) => {
  const { t } = useTranslation(['setting', 'common', 'channel']);
  const navigate = useWorkspaceAwareNavigate();
  const [pending, setPending] = useState(false);
  const content = skillPrompt(identifier, name, t('market.skills.mockPrompt'));

  const send = async (agentId: string) => {
    setPending(true);
    try {
      const channelId = await channelActions.openDirect(agentId);
      if (!channelId) {
        toast.error(t('openDirect.unavailable', { ns: 'channel' }));
        return;
      }
      await channelActions.send({
        channelId,
        content,
        mentions: [],
        requestKey: crypto.randomUUID(),
      });
      navigate(CHANNEL_URL(channelId));
    } catch (error) {
      console.error('[Market] Failed to send the skill prompt', error);
      toast.error(t('market.skills.sendFailed'));
    } finally {
      setPending(false);
    }
  };

  if (agents.length === 0)
    return (
      <ActionIcon
        aria-label={t('market.skills.copyPrompt')}
        icon={Copy}
        title={t('market.skills.copyPrompt')}
        variant={'filled'}
        onClick={async () => {
          await copyToClipboard(content);
          toast.success(t('copySuccess', { ns: 'common' }));
        }}
      />
    );

  if (agents.length === 1)
    return (
      <ActionIcon
        aria-label={t('market.skills.sendTo', { name: agentDisplayName(agents[0].agent) })}
        icon={ArrowRight}
        loading={pending}
        title={t('market.skills.sendTo', { name: agentDisplayName(agents[0].agent) })}
        variant={'filled'}
        onClick={() => void send(agents[0].agent.id)}
      />
    );

  return (
    <DropdownMenu
      placement={'bottomRight'}
      popupProps={{ style: { maxHeight: 320, maxWidth: 260, minWidth: 180, overflowY: 'auto' } }}
      items={agents.map(({ agent }) => {
        const agentName = agentDisplayName(agent, t('defaultSession', { ns: 'common' }));
        return {
          icon: (
            <AgentAvatar
              agentId={agent.id}
              avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
              background={agent.backgroundColor || undefined}
              name={agentName}
              size={20}
            />
          ),
          key: agent.id,
          label: agentName,
          onClick: () => void send(agent.id),
        };
      })}
    >
      <ActionIcon
        aria-label={t('market.skills.sendPick')}
        icon={ArrowRight}
        loading={pending}
        title={t('market.skills.sendPick')}
        variant={'filled'}
      />
    </DropdownMenu>
  );
});

SkillPromptSend.displayName = 'MarketSkillPromptSend';

export default SkillPromptSend;
