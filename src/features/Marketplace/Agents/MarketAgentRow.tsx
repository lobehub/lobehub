import { Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AssistantMarketSource } from '@/types/discover';

import MarketAgentAction from './MarketAgentAction';
import MarketAgentAvatar from './MarketAgentAvatar';
import type { MarketAgentSummary } from './marketAgentCatalog';
import { useOpenAgent } from './useOpenAgent';

const styles = stylex.create({
  action: {
    display: 'flex',
    flex: 'none',
  },
  author: {
    marginInlineStart: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 8,
    borderRadius: cssVar.borderRadiusLG,
    cursor: 'pointer',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
});

/**
 * One Marketplace Agent: picture, name with its author, blurb, and "+". It opens
 * its page, as does adding it.
 */
const MarketAgentRow = memo<{ agent: MarketAgentSummary; source?: AssistantMarketSource }>(
  ({ agent, source }) => {
    const { t } = useTranslation('discover');
    const openAgent = useOpenAgent(source);
    const open = () => openAgent(agent.id, agent.isGroup);
    const [hovered, setHovered] = useState(false);

    return (
      <div
        {...stylex.props(styles.row)}
        data-agent-type={agent.isGroup ? 'agent-group' : 'agent'}
        data-testid={'assistant-item'}
        onClick={open}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <MarketAgentAvatar
          avatar={agent.avatar}
          followPointer={hovered}
          identifier={agent.id}
          size={40}
          title={agent.title}
        />
        <span {...stylex.props(styles.text)}>
          <Text ellipsis weight={500}>
            {agent.title}
            {agent.author && (
              <Text as={'span'} fontSize={12} type={'secondary'} {...stylex.props(styles.author)}>
                {t('marketplaceAgents.by', { name: agent.author })}
              </Text>
            )}
          </Text>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {agent.description || t('marketplaceAgents.noDescription')}
          </Text>
        </span>
        <span {...stylex.props(styles.action)} onClick={(event) => event.stopPropagation()}>
          {agent.isGroup ? (
            <Tag size={'small'}>{t('groupAgents.tag')}</Tag>
          ) : (
            <MarketAgentAction id={agent.id} title={agent.title} onAdded={open} />
          )}
        </span>
      </div>
    );
  },
);

MarketAgentRow.displayName = 'MarketplaceAgentRow';

export default MarketAgentRow;
