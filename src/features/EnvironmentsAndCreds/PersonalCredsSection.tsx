'use client';

import { Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createCreateCredModal } from '@/features/Settings/creds/features/CreateCredModal';
import CredsList from '@/features/Settings/creds/features/CredsList';
import { personalCredsApi } from '@/features/Settings/creds/features/useCredsApi';
import { usePermission } from '@/hooks/usePermission';

import { CREDENTIALS_SECTION_ID } from './const';
import SectionTitle from './SectionTitle';
import { useScrollToSection } from './useScrollToSection';

/**
 * The personal vault on the personal Environments & Credentials page: every
 * credential here is the caller's own, so there is nothing to filter.
 */
const PersonalCredsSection = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [refreshKey, setRefreshKey] = useState(0);
  const ref = useScrollToSection<HTMLDivElement>(CREDENTIALS_SECTION_ID);

  const handleCreate = () => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi: personalCredsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
    });
  };

  return (
    <Flexbox gap={16} id={CREDENTIALS_SECTION_ID} ref={ref}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <SectionTitle title={t('environmentsAndCreds.section.creds')} />
        <Tooltip title={reason}>
          <Button
            disabled={!canManageCredentials}
            icon={<Icon icon={Plus} />}
            style={{ flex: 'none' }}
            type={'primary'}
            onClick={handleCreate}
          >
            {t('creds.create')}
          </Button>
        </Tooltip>
      </Flexbox>
      <CredsList key={refreshKey} />
    </Flexbox>
  );
});

PersonalCredsSection.displayName = 'PersonalCredsSection';

export default PersonalCredsSection;
