import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import type { SkillAgent } from './useSkillAgents';

/** Faces shown before the count; more would only crowd the row. */
const MAX_FACES = 3;

/**
 * An installed skill's row status: the faces of the assistants it is on for,
 * and "On for 1/2 assistants" (of those it was added to).
 */
const SkillAgentStatus = memo<{ agents: SkillAgent[] }>(({ agents }) => {
  const { t } = useTranslation('setting');
  const on = agents.filter((item) => item.enabled);

  if (agents.length === 0)
    return (
      <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
        {t('market.skills.agents.notAdded')}
      </Text>
    );

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      {on.length > 0 && (
        <Flexbox horizontal>
          {on.slice(0, MAX_FACES).map(({ agent }, index) => (
            <span
              key={agent.id}
              style={{
                borderRadius: '50%',
                boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}`,
                display: 'flex',
                marginInlineStart: index === 0 ? 0 : -6,
              }}
            >
              <AgentAvatar
                agentId={agent.id}
                avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
                background={agent.backgroundColor || undefined}
                name={agentDisplayName(agent)}
                size={18}
              />
            </span>
          ))}
        </Flexbox>
      )}
      <Text fontSize={12} type={'secondary'}>
        {t('market.skills.agents.enabledOn', { on: on.length, total: agents.length })}
      </Text>
    </Flexbox>
  );
});

SkillAgentStatus.displayName = 'MarketSkillAgentStatus';

export default SkillAgentStatus;
