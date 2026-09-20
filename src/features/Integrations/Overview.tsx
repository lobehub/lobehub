'use client';

import { Flexbox, Icon, SearchBar } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import IntegrationCard from './IntegrationCard';
import { filterIntegrations, type IntegrationId } from './registry';
import { useGithubIntegration } from './useGithubIntegration';

const styles = createStaticStyles(({ css, cssVar }) => ({
  emptyState: css`
    padding-block: 32px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  strip: css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
}));

interface OverviewProps {
  onOpen: (id: IntegrationId) => void;
}

/**
 * The integrations directory: a search box, the integrations already
 * connected in this scope, and everything available. Connection state per
 * integration comes from that integration's own hook so the list stays a
 * static registry.
 */
const Overview = memo<OverviewProps>(({ onOpen }) => {
  const { t } = useTranslation('integration');
  const [query, setQuery] = useState('');
  const github = useGithubIntegration();

  const enabledById: Record<IntegrationId, boolean> = { github: github.enabled };
  const matches = filterIntegrations(query);
  const enabled = matches.filter((item) => enabledById[item.id]);

  return (
    <Flexbox gap={28}>
      <SearchBar
        allowClear
        placeholder={t('overview.searchPlaceholder')}
        prefix={<Icon color={cssVar.colorTextDescription} icon={SearchIcon} />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {enabled.length > 0 ? (
        <Flexbox gap={12}>
          <span className={styles.sectionLabel}>{t('overview.enabled')}</span>
          <div className={styles.strip}>
            {enabled.map((item) => (
              <IntegrationCard compact enabled integration={item} key={item.id} onOpen={onOpen} />
            ))}
          </div>
        </Flexbox>
      ) : null}

      <Flexbox gap={12}>
        <span className={styles.sectionLabel}>{t('overview.all')}</span>
        {matches.length === 0 ? (
          <div className={styles.emptyState}>
            <Text type="secondary">{t('overview.noMatch', { query })}</Text>
          </div>
        ) : (
          <div className={styles.grid}>
            {matches.map((item) => (
              <IntegrationCard
                enabled={enabledById[item.id]}
                integration={item}
                key={item.id}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

Overview.displayName = 'IntegrationsOverview';

export default Overview;
