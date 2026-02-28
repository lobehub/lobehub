'use client';

import { BRANDING_PROVIDER, SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, BrainCircuitIcon, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { ProviderNavKey } from '@/types/discover';

import { useDetailContext } from '../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    link: css`
      color: ${cssVar.colorTextDescription};

      &:hover {
        color: ${cssVar.colorInfo};
      }
    `,
    nav: css`
      border-block-end: 1px solid ${cssVar.colorBorder};
    `,
  };
});

interface NavProps {
  activeTab?: ProviderNavKey;
  mobile?: boolean;
  setActiveTab?: (tab: ProviderNavKey) => void;
}

const Nav = memo<NavProps>(({ mobile, setActiveTab, activeTab = ProviderNavKey.Overview }) => {
  const { t } = useTranslation('discover');
  const { identifier } = useDetailContext();

  // Hide Guide tab for branding provider as it doesn't have integration docs
  const showGuideTab = identifier !== BRANDING_PROVIDER;

  const items = [
    {
      icon: <Icon icon={BookOpenIcon} size={16} />,
      key: ProviderNavKey.Overview,
      label: t('providers.details.overview.title'),
    },
    ...(showGuideTab
      ? [
          {
            icon: <Icon icon={BrainCircuitIcon} size={16} />,
            key: ProviderNavKey.Guide,
            label: t('providers.details.guide.title'),
          },
        ]
      : []),
    {
      icon: <Icon icon={ListIcon} size={16} />,
      key: ProviderNavKey.Related,
      label: t('providers.details.related.title'),
    },
  ];

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={items}
      onChange={(key) => setActiveTab?.(key as ProviderNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
      {nav}
      <Flexbox horizontal gap={12}>
        <a className={styles.link} href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
          {t('mcp.details.nav.needHelp')}
        </a>
        {identifier && (
          <a
            className={styles.link}
            rel="noreferrer"
            target="_blank"
            href={urlJoin(
              'https://github.com/lobehub/lobe-chat/tree/main/src/config/modelProviders',
              `${identifier}.ts`,
            )}
          >
            {t('mcp.details.nav.viewSourceCode')}
          </a>
        )}
        <a
          className={styles.link}
          href="https://github.com/lobehub/lobe-chat/issues/new/choose"
          rel="noreferrer"
          target="_blank"
        >
          {t('mcp.details.nav.reportIssue')}
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
