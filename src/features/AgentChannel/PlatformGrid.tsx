'use client';

import { agentDisplayName } from '@lobechat/types';
import { Avatar, createStaticStyles, responsive } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { type ChannelPlatformDefinition } from './const';
import PlatformCard from './PlatformCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;

    width: 100%;
    min-width: 0;

    ${responsive.md} {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    ${responsive.sm} {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  root: css`
    display: flex;
    flex-direction: column;
    align-items: center;

    width: 100%;
    padding-block: 24px;
    padding-inline: 24px;
  `,
  title: css`
    width: 100%;
    margin-block: 0 20px;

    font-size: 24px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};

    ${responsive.sm} {
      font-size: 20px;
    }
  `,
  titleAvatar: css`
    display: inline-flex;
    margin-inline: 6px;
    vertical-align: -6px;
  `,
  widthLimiter: css`
    width: 100%;
    max-width: 1024px;
  `,
}));

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
      <section className={styles.root}>
        <div className={styles.widthLimiter}>
          <h1 className={styles.title}>
            <Trans<'channel.home.title', 'agent'>
              i18nKey={'channel.home.title'}
              ns={'agent'}
              values={{ name: agentName }}
              components={{
                avatar: (
                  <span className={styles.titleAvatar}>
                    <Avatar
                      avatar={meta.avatar || DEFAULT_AVATAR}
                      background={meta.backgroundColor}
                      shape={'square'}
                      size={28}
                    />
                  </span>
                ),
              }}
            />
          </h1>
          <div className={styles.grid}>
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
