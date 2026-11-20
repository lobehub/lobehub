'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import PersonalCredsSection from '@/features/EnvironmentsAndCreds/PersonalCredsSection';
import SectionTitle from '@/features/EnvironmentsAndCreds/SectionTitle';

/**
 * Environments & Credentials, personal: `/settings/environments` lists the
 * caller's environments and, below them, their personal credential vault —
 * the definitions a run starts from and the secrets it reads, in one place.
 * `/settings/environments/:sub` is one environment's page.
 *
 * No gate: an environment is a definition, and writing one down needs no
 * drive. Only initializing a folder from it does, and that is asked where it
 * happens.
 */
const Page = memo(() => {
  const { t } = useTranslation('setting');
  const { sub: environmentId } = useParams<{ sub?: string }>();
  // Personal-only route: plain `navigate` keeps it out of any active workspace.
  const navigate = useNavigate();

  if (environmentId)
    return (
      <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
        <EnvironmentDetailPage
          environmentId={environmentId}
          key={environmentId}
          onBack={() => navigate('/settings/environments')}
        />
      </Flexbox>
    );

  return (
    <Flexbox gap={40} style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      <EnvironmentManager
        headerLeading={<SectionTitle title={t('environmentsAndCreds.section.environments')} />}
        onOpenEnvironment={(id) => navigate(`/settings/environments/${encodeURIComponent(id)}`)}
      />
      <PersonalCredsSection />
    </Flexbox>
  );
});

Page.displayName = 'EnvironmentsSetting';

export default Page;
