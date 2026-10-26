'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { ModelIcon } from '@/components/LobeIcons';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const styles = stylex.create({
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
  },
  model: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    width: 'fit-content',
    maxWidth: '100%',
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '6px',
    fontSize: '11.5px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
  root: {
    paddingBlock: '16px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

/**
 * Who this conversation is with: the agent's identity first, before the
 * workspace and Portal sections below it (IM-style channel info).
 */
const AgentProfileSection = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const title = agentDisplayName(meta, t('untitledAgent'));

  return (
    <Flexbox gap={10} {...stylex.props(styles.root)}>
      <Flexbox horizontal align={'center'} gap={12}>
        <Avatar
          emojiScaleWithBackground
          avatar={meta.avatar || DEFAULT_AVATAR}
          background={meta.backgroundColor || undefined}
          name={title}
          shape={'square'}
          size={44}
        />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Text ellipsis fontSize={15} weight={600}>
            {title}
          </Text>
          {model && (
            <span {...stylex.props(styles.model)}>
              <ModelIcon model={model} size={12} />
              <Text ellipsis fontSize={11.5} type={'secondary'}>
                {model}
              </Text>
            </span>
          )}
        </Flexbox>
      </Flexbox>
      {meta.description && <div {...stylex.props(styles.description)}>{meta.description}</div>}
      <Button block size={'small'} onClick={() => navigate(`/agent/${agentId}/profile`)}>
        {t('workingPanel.overview.profile.view')}
      </Button>
    </Flexbox>
  );
});

AgentProfileSection.displayName = 'AgentProfileSection';

export default AgentProfileSection;
