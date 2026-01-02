'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, BrainCircuitIcon, ListIcon } from 'lucide-react';
import Link from 'next/link';
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

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: ProviderNavKey.Overview,
          label: t('providers.details.overview.title'),
        },
        {
          icon: <Icon icon={BrainCircuitIcon} size={16} />,
          key: ProviderNavKey.Guide,
          label: t('providers.details.guide.title'),
        },
        {
          icon: <Icon icon={ListIcon} size={16} />,
          key: ProviderNavKey.Related,
          label: t('providers.details.related.title'),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as ProviderNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox align={'center'} className={styles.nav} horizontal justify={'space-between'}>
      {nav}
      <Flexbox gap={12} horizontal>
        <Link className={styles.link} href={SOCIAL_URL.discord} target={'_blank'}>
          {t('mcp.details.nav.needHelp')}
        </Link>
        {identifier && (
          <Link
            className={styles.link}
            href={urlJoin(
              'https://github.com/lobehub/lobe-chat/tree/main/src/config/modelProviders',
              `${identifier}.ts`,
            )}
            target={'_blank'}
          >
            {t('mcp.details.nav.viewSourceCode')}
          </Link>
        )}
        <Link
          className={styles.link}
          href={'https://github.com/lobehub/lobe-chat/issues/new/choose'}
          target={'_blank'}
        >
          {t('mcp.details.nav.reportIssue')}
        </Link>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
