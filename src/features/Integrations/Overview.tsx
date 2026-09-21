'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import IntegrationCard from './IntegrationCard';
import { type IntegrationId, INTEGRATIONS, UPCOMING_INTEGRATIONS } from './registry';
import { useGithubIntegration } from './useGithubIntegration';

const styles = createStaticStyles(({ css, cssVar }) => ({
  list: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  strip: css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  upcoming: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
}));

interface OverviewProps {
  onOpen: (id: IntegrationId) => void;
}

/**
 * The integrations directory: the integrations already connected in this
 * scope, everything available, and what is on the roadmap. Connection state
 * per integration comes from that integration's own hook so the list stays
 * a static registry.
 */
const Overview = memo<OverviewProps>(({ onOpen }) => {
  const { t } = useTranslation('integration');
  const github = useGithubIntegration();

  const enabledById: Record<IntegrationId, boolean> = { github: github.enabled };
  const enabled = INTEGRATIONS.filter((item) => enabledById[item.id]);

  return (
    <Flexbox gap={28}>
      {enabled.length > 0 ? (
        <Flexbox gap={10}>
          <span className={styles.sectionLabel}>{t('overview.enabled')}</span>
          <div className={styles.strip}>
            {enabled.map((item) => (
              <IntegrationCard compact enabled integration={item} key={item.id} onOpen={onOpen} />
            ))}
          </div>
        </Flexbox>
      ) : null}

      <Flexbox gap={10}>
        <span className={styles.sectionLabel}>{t('overview.all')}</span>
        <div className={styles.list}>
          {INTEGRATIONS.map((item) => (
            <IntegrationCard
              enabled={enabledById[item.id]}
              integration={item}
              key={item.id}
              onOpen={onOpen}
            />
          ))}
        </div>
      </Flexbox>

      <Flexbox gap={10}>
        <span className={styles.sectionLabel}>{t('overview.comingSoon')}</span>
        <div className={styles.upcoming}>
          {UPCOMING_INTEGRATIONS.map((item) => (
            <IntegrationCard upcoming integration={item} key={item.id} />
          ))}
        </div>
      </Flexbox>
    </Flexbox>
  );
});

Overview.displayName = 'IntegrationsOverview';

export default Overview;
