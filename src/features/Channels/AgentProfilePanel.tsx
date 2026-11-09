import type { ChannelPublicMember } from '@lobechat/types';
import { agentSecondaryDisplayName } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SquareArrowOutUpRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ModelIcon } from '@/components/LobeIcons';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';
import { ChannelSidePanel } from './MemberPanel';

const styles = stylex.create({
  description: {
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
  detail: {
    paddingBlock: '16px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  hero: {
    position: 'relative',
    paddingBlockStart: '28px',
    paddingBlockEnd: '16px',
    paddingInline: '40px',
    textAlign: 'center',
  },
  label: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  model: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    maxWidth: '100%',
    fontSize: '13px',
    color: cssVar.colorText,
  },
  placeholder: {
    fontSize: '13px',
    color: cssVar.colorTextQuaternary,
  },
  role: {
    overflow: 'hidden',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    maxWidth: '100%',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** A direct conversation's side panel: the Agent's contact card, like an IM profile. */
export function AgentProfilePanel({
  agentId,
  availableWidth,
  id,
  member,
  onClose,
}: {
  agentId: string;
  availableWidth?: number;
  id: string;
  member: ChannelPublicMember;
  onClose: () => void;
}) {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);
  // A Channel has no active Agent, so nothing else loads this one's config.
  useHydrateAgentConfig(true, agentId);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const slug = useAgentStore(agentSelectors.getAgentSlugById(agentId));
  const model = useAgentStore((s) => s.agentMap[agentId]?.model);
  const name = memberName(member, t('deletedMember'));
  const roleLine = [agentSecondaryDisplayName(meta), slug ? `@${slug}` : undefined]
    .filter(Boolean)
    .join(' · ');

  return (
    <ChannelSidePanel
      availableWidth={availableWidth}
      closeLabel={t('profile.hide')}
      id={id}
      label={t('profile.title')}
      title={t('profile.title')}
      onClose={onClose}
    >
      <Flexbox style={{ minHeight: 0, overflowY: 'auto' }}>
        <Flexbox align="center" gap={6} {...stylex.props(styles.hero)}>
          <ActionIcon
            icon={SquareArrowOutUpRightIcon}
            size="small"
            style={{ insetBlockStart: 10, insetInlineEnd: 10, position: 'absolute' }}
            title={t('profile.view')}
            onClick={() => navigate(`/agent/${agentId}/profile`)}
          />
          <MemberAvatar member={member} size={64} />
          <Text ellipsis fontSize={17} style={{ maxWidth: '100%' }} weight={600}>
            {name}
          </Text>
          {roleLine && <span {...stylex.props(styles.role)}>{roleLine}</span>}
        </Flexbox>
        <Flexbox gap={16} {...stylex.props(styles.detail)}>
          <Flexbox gap={6}>
            <span {...stylex.props(styles.label)}>{t('profile.about')}</span>
            {member.description ? (
              <span {...stylex.props(styles.description)}>{member.description}</span>
            ) : (
              <span {...stylex.props(styles.placeholder)}>{t('profile.noDescription')}</span>
            )}
          </Flexbox>
          {model && (
            <Flexbox gap={6}>
              <span {...stylex.props(styles.label)}>{t('profile.model')}</span>
              <span {...stylex.props(styles.model)}>
                <ModelIcon model={model} size={14} />
                <Text ellipsis>{model}</Text>
              </span>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </ChannelSidePanel>
  );
}
