'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentSearchItem, SearchAgentParams, SearchAgentState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentItem: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 6px;
    background: ${cssVar.colorFillQuaternary};
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
        {agents.map((agent: AgentSearchItem) => (
          <Flexbox align={'center'} className={styles.agentItem} gap={12} horizontal key={agent.id}>
            <Avatar
              avatar={agent.avatar || DEFAULT_AVATAR}
              background={agent.backgroundColor || theme.colorBgContainer}
              shape={'square'}
              size={32}
              title={agent.title || undefined}
            />
            <Flexbox flex={1} gap={2}>
              <Flexbox align={'center'} gap={8} horizontal>
                <span className={styles.agentTitle}>{agent.title || agent.id}</span>
                {agent.isMarket && <span className={styles.marketBadge}>Market</span>}
              </Flexbox>
              {agent.description && <span className={styles.description}>{agent.description}</span>}
            </Flexbox>
          </Flexbox>
        ))}
      </div>
    );
  },
);

SearchAgentRender.displayName = 'SearchAgentRender';

export default SearchAgentRender;
