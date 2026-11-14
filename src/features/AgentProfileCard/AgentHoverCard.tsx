'use client';

import { Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { Blocks, Bot, BrainCircuit, SquareTerminal, UserRound } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import UserAvatar from '@/components/UserAvatar';
import type { WorkspaceMemberProfile } from '@/features/MemberProfileCard/useWorkspaceMemberProfile';
import ProfileHoverCard, { ProfileHoverCardRow } from '@/features/ProfileHoverCard';

export interface AgentHoverCardProps {
  agentId: string;
  avatar?: string | null;
  backgroundColor?: string | null;
  /** The workspace member who created the Agent, when known. */
  creator?: WorkspaceMemberProfile;
  description?: string | null;
  /** Skill / library / file counts, shown only to someone who can configure the Agent. */
  inventory?: { files: number; knowledgeBases: number; skills: number };
  /** True while the configurable detail (model, inventory) is still loading. */
  loading?: boolean;
  model?: string | null;
  onHeaderClick?: () => void;
  /** External runtime name (e.g. Claude Code); replaces the model, which it does not use. */
  runtimeLabel?: string;
  title: string;
}

/**
 * An Agent as a teammate: an "Agent" tag next to the name so it never reads as
 * a person, what it does, then what runs it and who to ask about it.
 */
const AgentHoverCard = memo<AgentHoverCardProps>(
  ({
    agentId,
    avatar,
    backgroundColor,
    creator,
    description,
    inventory,
    loading,
    model,
    onHeaderClick,
    runtimeLabel,
    title,
  }) => {
    const { t } = useTranslation('chat');

    const inventoryText = inventory
      ? [
          inventory.skills > 0 && t('agentProfile.skills', { count: inventory.skills }),
          inventory.knowledgeBases > 0 &&
            t('agentProfile.knowledgeBases', { count: inventory.knowledgeBases }),
          inventory.files > 0 && t('agentProfile.files', { count: inventory.files }),
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

    return (
      <ProfileHoverCard
        description={description}
        testId={'agent-hover-card'}
        title={title}
        avatar={
          <AgentAvatar
            agentId={agentId}
            avatar={avatar}
            background={backgroundColor ?? undefined}
            name={title}
            shape={'square'}
            size={44}
          />
        }
        tag={
          <Tag size={'small'}>
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={Bot} size={12} />
              {t('agentProfile.tag')}
            </Flexbox>
          </Tag>
        }
        onHeaderClick={onHeaderClick}
      >
        {runtimeLabel ? (
          <ProfileHoverCardRow icon={SquareTerminal} label={t('agentProfile.runtimeLabel')}>
            <Text ellipsis>{t('agentProfile.runtime', { name: runtimeLabel })}</Text>
          </ProfileHoverCardRow>
        ) : model ? (
          <ProfileHoverCardRow icon={BrainCircuit} label={t('agentProfile.modelLabel')}>
            <Text ellipsis>{model}</Text>
          </ProfileHoverCardRow>
        ) : loading ? (
          <Skeleton height={20} width={120} />
        ) : null}
        {inventoryText && (
          <ProfileHoverCardRow icon={Blocks} label={t('agentProfile.inventoryLabel')}>
            <Text ellipsis>{inventoryText}</Text>
          </ProfileHoverCardRow>
        )}
        {creator && (
          <ProfileHoverCardRow icon={UserRound} label={t('agentProfile.creator')}>
            <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
              <UserAvatar avatar={creator.avatar} name={creator.name} shape={'circle'} size={18} />
              <Text ellipsis>{creator.name}</Text>
              <Text style={{ flex: 'none' }} type={'secondary'}>
                {t('agentProfile.creator')}
              </Text>
            </Flexbox>
          </ProfileHoverCardRow>
        )}
      </ProfileHoverCard>
    );
  },
);

AgentHoverCard.displayName = 'AgentHoverCard';

export default AgentHoverCard;
