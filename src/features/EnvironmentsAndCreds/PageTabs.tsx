'use client';

import { Tabs } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type PageTab } from './const';

interface PageTabsProps {
  onChange: (tab: PageTab) => void;
  value: PageTab;
}

/**
 * The two tabs of the Environments & Vault page. They sit at the left of the
 * open tab's header row, beside that tab's own filter and create button, so
 * the page has one header row. The tabs fill their parent by default, which
 * would push those actions onto a second line, so they take only their own
 * width.
 */
const PageTabs = memo<PageTabsProps>(({ onChange, value }) => {
  const { t } = useTranslation('setting');

  return (
    <Tabs
      activeKey={value}
      style={{ flex: 'none', width: 'fit-content' }}
      variant={'rounded'}
      items={[
        { key: 'environments', label: t('environmentsAndCreds.tabs.environments') },
        { key: 'vault', label: t('environmentsAndCreds.tabs.vault') },
      ]}
      onChange={(key) => onChange(key as PageTab)}
    />
  );
});

PageTabs.displayName = 'EnvironmentsAndVaultTabs';

export default PageTabs;
