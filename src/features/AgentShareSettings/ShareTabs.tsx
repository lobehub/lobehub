'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChartColumnIcon, KeyRoundIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ShareSettingsTab } from './useShareSettingsTab';

const styles = createStaticStyles(({ css, cssVar }) => ({
  nav: css`
    border-block-end: 1px solid ${cssVar.colorBorder};
  `,
}));

interface ShareTabsProps {
  active: ShareSettingsTab;
  onChange: (tab: ShareSettingsTab) => void;
}

/**
 * Underline tab strip splitting the share page into what the owner grants
 * (access) and what the share has done (stats) — the same nav pattern as the
 * marketplace detail pages, so it reads as in-page navigation rather than
 * another Segmented control competing with the profile switcher in the header.
 */
const ShareTabs = memo<ShareTabsProps>(({ active, onChange }) => {
  const { t } = useTranslation('agent');

  return (
    <Flexbox className={styles.nav}>
      <Tabs
        activeKey={active}
        variant={'square'}
        items={[
          {
            icon: <Icon icon={KeyRoundIcon} size={16} />,
            key: 'access',
            label: t('share.settings.tabs.access'),
          },
          {
            icon: <Icon icon={ChartColumnIcon} size={16} />,
            key: 'stats',
            label: t('share.settings.tabs.stats'),
          },
        ]}
        onChange={(key) => onChange(key as ShareSettingsTab)}
      />
    </Flexbox>
  );
});

ShareTabs.displayName = 'AgentShareTabs';

export default ShareTabs;
