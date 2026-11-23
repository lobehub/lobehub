import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketAgentAction from './MarketAgentAction';
import MarketAgentAvatar from './MarketAgentAvatar';
import type { MarketAgentSummary } from './marketAgentCatalog';
import MarketCard from './MarketCard';
import { useOpenAgent } from './useOpenAgent';

const styles = stylex.create({
  action: { display: 'flex' },
  blurb: { minHeight: 40 },
  head: { marginBlockEnd: 4 },
});

/** A featured Agent: a Surface card with its picture and "+", name, author, blurb and skills. */
const FeaturedAgentCard = memo<{ agent: MarketAgentSummary }>(({ agent }) => {
  const { t } = useTranslation('discover');
  const openAgent = useOpenAgent('new');
  const open = () => openAgent(agent.id);
  const [hovered, setHovered] = useState(false);

  return (
    <MarketCard gap={8} onClick={open} onHoverChange={setHovered}>
      <Flexbox
        horizontal
        align={'flex-start'}
        justify={'space-between'}
        {...stylex.props(styles.head)}
      >
        <MarketAgentAvatar
          avatar={agent.avatar}
          followPointer={hovered}
          identifier={agent.id}
          size={48}
          title={agent.title}
        />
        <span {...stylex.props(styles.action)} onClick={(event) => event.stopPropagation()}>
          <MarketAgentAction id={agent.id} title={agent.title} onAdded={open} />
        </span>
      </Flexbox>
      <Flexbox gap={2}>
        <Text ellipsis weight={600}>
          {agent.title}
        </Text>
        {agent.author && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {t('marketplaceAgents.by', { name: agent.author })}
          </Text>
        )}
      </Flexbox>
      <Text ellipsis={{ rows: 2 }} fontSize={13} type={'secondary'} {...stylex.props(styles.blurb)}>
        {agent.description || t('marketplaceAgents.noDescription')}
      </Text>
      {!!agent.pluginCount && agent.pluginCount > 0 && (
        <Text fontSize={12} type={'secondary'}>
          {t('marketplaceAgents.skillCount', { count: agent.pluginCount })}
        </Text>
      )}
    </MarketCard>
  );
});

FeaturedAgentCard.displayName = 'MarketplaceFeaturedAgentCard';

export default FeaturedAgentCard;
