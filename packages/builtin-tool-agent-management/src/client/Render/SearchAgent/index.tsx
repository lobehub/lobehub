'use client';

import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { BuiltinRenderProps } from '@lobechat/types';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { createStaticStyles, Flexbox, useTheme } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import type { AgentSearchItem, SearchAgentParams, SearchAgentState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentItem: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 6px;
    background: ${cssVar.colorFillQuaternary};
  `,
  agentRole: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  agentTitle: css`
    font-size: 13px;
    font-weight: 500;
  `,
  container: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding: 12px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  heteroBadge: css`
    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 10px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  marketBadge: css`
    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 10px;
    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  noResults: css`
    padding: 12px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
}));

export const SearchAgentRender = memo<BuiltinRenderProps<SearchAgentParams, SearchAgentState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('plugin');
    const theme = useTheme();
    const agents = pluginState?.agents || [];

    if (agents.length === 0) {
      return (
        <div className={styles.noResults}>
          {t('builtins.lobe-agent-builder.inspector.noResults')}
        </div>
      );
    }

    return (
      <div className={styles.container}>
        {agents.map((agent: AgentSearchItem) => {
          const displayName = agentDisplayName(agent, agent.id);
          const role = agentSecondaryDisplayName(agent);

          return (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.agentItem}
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
                  <span className={styles.agentTitle}>{displayName}</span>
                  {role && <span className={styles.agentRole}>{role}</span>}
                  {agent.heteroType && (
                    <span className={styles.heteroBadge}>
                      {HETEROGENEOUS_TYPE_LABELS[agent.heteroType] ?? agent.heteroType}
                    </span>
                  )}
                  {agent.isMarket && <span className={styles.marketBadge}>Market</span>}
                </Flexbox>
                {agent.description && (
                  <span className={styles.description}>{agent.description}</span>
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
