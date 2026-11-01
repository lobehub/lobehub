// Fixture: a settings page body stretched across the whole main area.
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from '@lobehub/ui';
import { memo } from 'react';

import IntegrationCard from './IntegrationCard';
import { useIntegrations } from './useIntegrations';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    width: 100%;
    padding-block: 24px;
    padding-inline: 32px;
  `,
}));

const IntegrationsPage = memo(() => {
  const integrations = useIntegrations();

  return (
    // alint-expect
    <Flexbox className={styles.body} gap={12}>
      {integrations.map((item) => (
        <IntegrationCard integration={item} key={item.id} />
      ))}
    </Flexbox>
  );
});

export default IntegrationsPage;
