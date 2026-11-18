'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EnvironmentFormValue } from './EnvironmentForm';
import PanelSection from './PanelSection';

/**
 * What someone who cannot change an environment reads: what it will do — the
 * repositories it checks out with their own setup, the setup after them, and
 * which variables it sets (names only). Laid out like the form, flat.
 */
const EnvironmentSummary = memo<{ environment: EnvironmentFormValue }>(({ environment }) => {
  const { t } = useTranslation('setting');
  const configuration = environment.configuration ?? {};
  const repositories = (configuration.sources ?? []).flatMap((source) =>
    source.kind === 'git' && source.url
      ? [
          {
            name: source.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''),
            setupCommand: (source as { setupCommand?: string }).setupCommand,
          },
        ]
      : [],
  );
  const variables = Object.keys(configuration.env ?? {});

  return (
    <Flexbox>
      <PanelSection title={t('environments.form.sources')}>
        {repositories.length > 0 ? (
          repositories.map((repository) => (
            <Flexbox gap={4} key={repository.name}>
              <Text fontSize={13} weight={500}>
                {repository.name}
              </Text>
              {repository.setupCommand && (
                <Text code fontSize={12}>
                  {repository.setupCommand}
                </Text>
              )}
            </Flexbox>
          ))
        ) : (
          <Text fontSize={13} type={'secondary'}>
            {t('environments.detail.noRepository')}
          </Text>
        )}
      </PanelSection>
      <PanelSection title={t('environments.form.setup')}>
        <Text code={!!configuration.bootstrapCommand} fontSize={13}>
          {configuration.bootstrapCommand || t('environments.detail.noSetup')}
        </Text>
      </PanelSection>
      <PanelSection title={t('environments.form.env')}>
        <Text fontSize={13} type={variables.length ? undefined : 'secondary'}>
          {variables.length ? variables.join(', ') : t('environments.form.noVariables')}
        </Text>
      </PanelSection>
    </Flexbox>
  );
});

EnvironmentSummary.displayName = 'EnvironmentSummary';

export default EnvironmentSummary;
