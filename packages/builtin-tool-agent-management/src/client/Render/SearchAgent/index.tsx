'use client';

import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { BuiltinRenderProps } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Flexbox, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import type { AgentSearchItem, SearchAgentParams, SearchAgentState } from '../../../types';

const styles = stylex.create({
  agentItem: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '6px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  agentRole: { fontSize: '12px', color: cssVar.colorTextTertiary },
  agentTitle: { fontSize: '13px', fontWeight: 500 },
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  heteroBadge: {
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '10px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  marketBadge: {
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '10px',
    color: cssVar.colorPrimary,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
  noResults: {
    padding: '12px',
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
});

export const SearchAgentRender = memo<BuiltinRenderProps<SearchAgentParams, SearchAgentState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('plugin');
    const theme = useTheme();
    const agents = pluginState?.agents || [];

    if (agents.length === 0) {
      return (
        <div {...stylex.props(styles.noResults)}>
          {t('builtins.lobe-agent-builder.inspector.noResults')}
        </div>
      );
    }

    return (
      <div {...stylex.props(styles.container)}>
        {agents.map((agent: AgentSearchItem) => {
          const displayName = agentDisplayName(agent, agent.id);
          const role = agentSecondaryDisplayName(agent);

          return (
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.agentItem).className}
              gap={12}
              key={agent.id}
            >
              <AgentAvatar
                agentId={agent.id}
                avatar={agent.avatar}
                background={agent.backgroundColor || theme.colorBgContainer}
                shape={'square'}
                size={32}
                title={displayName}
              />
              <Flexbox flex={1} gap={2}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <span {...stylex.props(styles.agentTitle)}>{displayName}</span>
                  {role && <span {...stylex.props(styles.agentRole)}>{role}</span>}
                  {agent.heteroType && (
                    <span {...stylex.props(styles.heteroBadge)}>
                      {HETEROGENEOUS_TYPE_LABELS[agent.heteroType] ?? agent.heteroType}
                    </span>
                  )}
                  {agent.isMarket && <span {...stylex.props(styles.marketBadge)}>Market</span>}
                </Flexbox>
                {agent.description && (
                  <span {...stylex.props(styles.description)}>{agent.description}</span>
                )}
              </Flexbox>
            </Flexbox>
          );
        })}
      </div>
    );
  },
);

SearchAgentRender.displayName = 'SearchAgentRender';

export default SearchAgentRender;
