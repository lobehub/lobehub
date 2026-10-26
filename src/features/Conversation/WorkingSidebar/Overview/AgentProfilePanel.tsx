'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Flexbox, Segmented, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { ModelIcon } from '@/components/LobeIcons';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

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
  },
  hero: {
    paddingBlockStart: '20px',
    paddingBlockEnd: '14px',
    paddingInline: '16px',
  },
  role: {
    overflow: 'hidden',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
  tabs: {
    paddingBlockEnd: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

type ProfileTab = 'detail' | 'workspace';

interface AgentProfilePanelProps {
  agentId: string;
  /** The existing working-panel overview (workspace, outputs, Portal entries). */
  workspace: ReactNode;
}

/**
 * The conversation's right panel opens as the agent's profile, like an IM
 * contact card: avatar beside title and role, then Details and the Workspace (the former
 * overview, with Portal entries) as tabs.
 */
const AgentProfilePanel = memo<AgentProfilePanelProps>(({ agentId, workspace }) => {
  const { t } = useTranslation('chat');
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const [tab, setTab] = useState<ProfileTab>('detail');
  const slug = useAgentStore((s) => s.agentMap[agentId]?.slug);
  const title = agentDisplayName(meta, t('untitledAgent'));
  // Same identity line as the profile page: role (when the agent has its own
  // name) and the @handle.
  const roleLine = [agentSecondaryDisplayName(meta), slug ? `@${slug}` : undefined]
    .filter(Boolean)
    .join(' · ');

  return (
    <Flexbox>
      <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.hero)}>
        <Avatar
          emojiScaleWithBackground
          avatar={meta.avatar || DEFAULT_AVATAR}
          background={meta.backgroundColor || undefined}
          name={title}
          shape={'square'}
          size={52}
        />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis fontSize={16} weight={600}>
            {title}
          </Text>
          {roleLine && <span {...stylex.props(styles.role)}>{roleLine}</span>}
        </Flexbox>
      </Flexbox>
      <Flexbox align={'center'} {...stylex.props(styles.tabs)}>
        <Segmented
          size={'small'}
          // Segmented pins itself to the start; center it under the identity.
          style={{ alignSelf: 'center' }}
          value={tab}
          options={[
            { label: t('workingPanel.profile.tabs.detail'), value: 'detail' },
            { label: t('workingPanel.profile.tabs.workspace'), value: 'workspace' },
          ]}
          onChange={(value) => setTab(value as ProfileTab)}
        />
      </Flexbox>
      {tab === 'detail' ? (
        <Flexbox gap={16} {...stylex.props(styles.detail)}>
          <Flexbox gap={6}>
            <span {...stylex.props(styles.label)}>{t('workingPanel.profile.description')}</span>
            {meta.description ? (
              <span {...stylex.props(styles.description)}>{meta.description}</span>
            ) : (
              <span {...stylex.props(styles.placeholder)}>
                {t('workingPanel.profile.noDescription')}
              </span>
            )}
          </Flexbox>
          {model && (
            <Flexbox gap={6}>
              <span {...stylex.props(styles.label)}>{t('workingPanel.profile.model')}</span>
              <span {...stylex.props(styles.model)}>
                <ModelIcon model={model} size={14} />
                <Text ellipsis>{model}</Text>
              </span>
            </Flexbox>
          )}
        </Flexbox>
      ) : (
        workspace
      )}
    </Flexbox>
  );
});

AgentProfilePanel.displayName = 'AgentProfilePanel';

export default AgentProfilePanel;
