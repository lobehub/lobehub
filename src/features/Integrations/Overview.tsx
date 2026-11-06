'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import IntegrationCard from './IntegrationCard';
import { type IntegrationId, INTEGRATIONS, UPCOMING_INTEGRATIONS } from './registry';
import { useGithubIntegration } from './useGithubIntegration';
import { useLinearIntegration } from './useLinearIntegration';

const styles = stylex.create({
  list: { display: 'grid', gridTemplateColumns: '1fr', gap: '10px' },
  sectionLabel: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextTertiary },
  strip: {
    display: 'grid',
    gridTemplateColumns: { 'default': 'repeat(3, 1fr)', '@media (width <= 720px)': '1fr' },
    gap: '10px',
  },
  upcoming: {
    display: 'grid',
    gridTemplateColumns: { 'default': 'repeat(2, 1fr)', '@media (width <= 720px)': '1fr' },
    gap: '8px',
  },
});

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
  const linear = useLinearIntegration();

  const enabledById: Record<IntegrationId, boolean> = {
    github: github.enabled,
    linear: linear.enabled,
  };
  const enabled = INTEGRATIONS.filter((item) => enabledById[item.id]);

  return (
    <Flexbox gap={24}>
      {enabled.length > 0 ? (
        <Flexbox gap={10}>
          <span {...stylex.props(styles.sectionLabel)}>{t('overview.enabled')}</span>
          <div {...stylex.props(styles.strip)}>
            {enabled.map((item) => (
              <IntegrationCard compact enabled integration={item} key={item.id} onOpen={onOpen} />
            ))}
          </div>
        </Flexbox>
      ) : null}

      <Flexbox gap={10}>
        <span {...stylex.props(styles.sectionLabel)}>{t('overview.all')}</span>
        <div {...stylex.props(styles.list)}>
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
        <span {...stylex.props(styles.sectionLabel)}>{t('overview.comingSoon')}</span>
        <div {...stylex.props(styles.upcoming)}>
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
