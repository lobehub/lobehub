import { agentDisplayName } from '@lobechat/types';
import { Button, Center, Flexbox, Switch, Text } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { SkeletonBar } from '@/components/Skeleton';

import type { SkillAgent } from './useSkillAgents';

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingBlock: 12,
    paddingInline: 16,
    borderBlockStartWidth: {
      'default': 1,
      ':first-child': 0,
    },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: `var(--lobe-fill-border, ${cssVar.colorFillSecondary})`,
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
});

interface SkillAgentListProps {
  agents: SkillAgent[];
  /** My assistants' configs are still loading, so the list may be incomplete. */
  loading?: boolean;
  onRemove: (agentId: string) => void;
  onRemoveAll: () => void;
  onToggle: (agentId: string, on: boolean) => void;
  pendingIds: string[];
}

/**
 * An installed skill's assistants: each one can switch it off or drop it, and
 * "Remove all" takes it off every one of them. With none yet, it points at
 * "Add to assistant" in the header.
 */
const SkillAgentList = memo<SkillAgentListProps>(
  ({ agents, loading, onRemove, onRemoveAll, onToggle, pendingIds }) => {
    const { t } = useTranslation(['setting', 'common']);
    const removingAll =
      agents.length > 0 && agents.every(({ agent }) => pendingIds.includes(agent.id));

    return (
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text weight={600}>{t('market.skills.agents.title', { count: agents.length })}</Text>
          {agents.length > 0 && (
            <Button loading={removingAll} type={'fill'} onClick={onRemoveAll}>
              {t('market.skills.agents.removeAll')}
            </Button>
          )}
        </Flexbox>
        <Surface>
          {agents.length === 0 &&
            (loading ? (
              <div {...stylex.props(styles.row)}>
                <SkeletonBar height={32} radius={16} width={32} />
                <SkeletonBar height={14} width={160} />
              </div>
            ) : (
              <Center gap={4} paddingBlock={24} paddingInline={16}>
                <Text type={'secondary'}>{t('market.skills.agents.empty')}</Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('market.skills.agents.emptyHint')}
                </Text>
              </Center>
            ))}
          {agents.map(({ agent, enabled }) => {
            const pending = pendingIds.includes(agent.id);
            const name = agentDisplayName(agent, t('defaultSession', { ns: 'common' }));
            return (
              <div key={agent.id} {...stylex.props(styles.row)}>
                <AgentAvatar
                  agentId={agent.id}
                  avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
                  background={agent.backgroundColor || undefined}
                  name={name}
                  size={32}
                />
                <span {...stylex.props(styles.text)}>
                  <Text ellipsis weight={500}>
                    {name}
                  </Text>
                  {agent.description && (
                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {agent.description}
                    </Text>
                  )}
                </span>
                <Switch
                  checked={enabled}
                  disabled={pending}
                  size={'small'}
                  onChange={(on) => onToggle(agent.id, on)}
                />
                <Button disabled={pending} type={'fill'} onClick={() => onRemove(agent.id)}>
                  {t('market.skills.agents.remove')}
                </Button>
              </div>
            );
          })}
        </Surface>
      </Flexbox>
    );
  },
);

SkillAgentList.displayName = 'MarketSkillAgentList';

export default SkillAgentList;
