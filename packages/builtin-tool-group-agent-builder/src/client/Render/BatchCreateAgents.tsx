'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ToolTag from '@/features/ToolTag';

import type { BatchCreateAgentsParams, BatchCreateAgentsState } from '../../types';

const styles = stylex.create({
  container: {
    paddingBlock: '4px',
    paddingInline: '16px',
    borderRadius: '8px',
    background: cssVar.colorFillQuaternary,
  },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
  },
  empty: { padding: '16px', color: cssVar.colorTextTertiary },
  item: {
    paddingBlock: '12px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  title: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface AgentItemProps {
  agent: {
    agentId: string;
    success: boolean;
    title: string;
  };
  definition?: {
    avatar?: string;
    description?: string;
    title: string;
    tools?: string[];
  };
}

const AgentItem = memo<AgentItemProps>(({ agent, definition }) => {
  const avatar = definition?.avatar;
  const description = definition?.description;
  const tools = definition?.tools;

  return (
    <Flexbox horizontal align="flex-start" className={stylex.props(styles.item).className} gap={12}>
      <Avatar
        avatar={avatar}
        size={24}
        style={{ flexShrink: 0, marginTop: 4 }}
        title={agent.title}
      />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
        <span {...stylex.props(styles.title)}>{agent.title}</span>
        {description && <span {...stylex.props(styles.description)}>{description}</span>}
        {tools && tools.length > 0 && (
          <Flexbox horizontal gap={4} style={{ marginTop: 8 }} wrap={'wrap'}>
            {tools.map((tool) => (
              <ToolTag identifier={tool} key={tool} variant={'compact'} />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

const BatchCreateAgentsRender = memo<
  BuiltinRenderProps<BatchCreateAgentsParams, BatchCreateAgentsState>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');
  const { agents: resultAgents } = pluginState || {};
  const definitions = args?.agents || [];

  if (!resultAgents || resultAgents.length === 0) {
    return (
      <Flexbox align="center" className={stylex.props(styles.empty).className} gap={8}>
        <Users size={24} />
        <span>{t('builtins.lobe-group-agent-builder.inspector.noResults')}</span>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      {resultAgents.map((agent, index) => (
        <AgentItem agent={agent} definition={definitions[index]} key={agent.agentId || index} />
      ))}
    </Flexbox>
  );
});

export default BatchCreateAgentsRender;
