'use client';

import { BRANDING_PROVIDER, SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, BrainCircuitIcon, ListIcon, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { GITHUB, GITHUB_ISSUES } from '@/const/url';
import { ProviderNavKey } from '@/types/discover';

import { useDetailContext } from '../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    link: css`
      display: inline-flex;
      gap: 4px;
      align-items: center;
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
      items={items}
      variant="square"
      onChange={(key) => setActiveTab?.(key as ProviderNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
      {nav}
      <Flexbox
        horizontal
        flex="none"
        gap={12}
        style={{ marginInlineStart: 12, whiteSpace: 'nowrap' }}
      >
        <a className={styles.link} href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
          {t('mcp.details.nav.needHelp')}
          <Icon icon={SquareArrowOutUpRight} size={12} />
        </a>
        {identifier && (
          <a
            className={styles.link}
            href={urlJoin(GITHUB, 'tree/main/src/config/modelProviders', `${identifier}.ts`)}
            rel="noreferrer"
            target="_blank"
          >
            {t('mcp.details.nav.viewSourceCode')}
            <Icon icon={SquareArrowOutUpRight} size={12} />
          </a>
        )}
        <a className={styles.link} href={GITHUB_ISSUES} rel="noreferrer" target="_blank">
          {t('mcp.details.nav.reportIssue')}
          <Icon icon={SquareArrowOutUpRight} size={12} />
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
