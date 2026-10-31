'use client';

import { agentDisplayName } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { type ChannelPlatformDefinition } from './const';
import PlatformCard from './PlatformCard';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      [media.md]: 'repeat(2, minmax(0, 1fr))',
      [media.sm]: 'minmax(0, 1fr)',
    },
    gap: '12px',
    width: '100%',
    minWidth: '0',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '24px',
    paddingInline: '24px',
  },
  title: {
    width: '100%',
    marginBlockStart: '0',
    marginBlockEnd: '20px',
    fontSize: { default: '24px', [media.sm]: '20px' },
    fontWeight: 600,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
  titleAvatar: { display: 'inline-flex', marginInline: '6px', verticalAlign: '-6px' },
  widthLimiter: { width: '100%', maxWidth: '1024px' },
});

interface PlatformGridProps {
  agentId: string;
  onSelect: (id: string) => void;
  platforms: ChannelPlatformDefinition[];
  runtimeStatuses: Map<string, BotRuntimeStatus>;
}

const PlatformGrid = memo<PlatformGridProps>(
  ({ agentId, platforms, onSelect, runtimeStatuses }) => {
    const { t } = useTranslation(['agent', 'common']);
    const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
    const agentName = agentDisplayName(meta, t('defaultSession', { ns: 'common' }));

    return (
      <section {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.widthLimiter)}>
          <h1 {...stylex.props(styles.title)}>
            <Trans<'channel.home.title', 'agent'>
              i18nKey={'channel.home.title'}
              ns={'agent'}
              values={{ name: agentName }}
              components={{
                avatar: (
                  <span className={stylex.props(styles.titleAvatar).className}>
                    <AgentAvatar
                      agentId={agentId}
                      avatar={meta.avatar}
                      background={meta.backgroundColor}
                      shape={'square'}
                      size={28}
                    />
                  </span>
                ),
              }}
            />
          </h1>
          <div {...stylex.props(styles.grid)}>
            {platforms.map((platform) => (
              <PlatformCard
                key={platform.id}
                platform={platform}
                status={runtimeStatuses.get(platform.id)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </section>
    );
  },
);

PlatformGrid.displayName = 'PlatformGrid';

export default PlatformGrid;
