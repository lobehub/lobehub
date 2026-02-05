'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, ListIcon, Settings2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelNavKey } from '@/types/discover';

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
  activeTab?: ModelNavKey;
  mobile?: boolean;
  setActiveTab?: (tab: ModelNavKey) => void;
}

const Nav = memo<NavProps>(({ mobile, setActiveTab, activeTab = ModelNavKey.Overview }) => {
  const { t } = useTranslation('discover');

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: ModelNavKey.Overview,
          label: t('models.details.overview.title'),
        },
        {
          icon: <Icon icon={Settings2Icon} size={16} />,
          key: ModelNavKey.Parameter,
          label: t('models.parameterList.title'),
        },
        {
          icon: <Icon icon={ListIcon} size={16} />,
          key: ModelNavKey.Related,
          label: t('models.details.related.title'),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as ModelNavKey)}
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
        <a
          className={styles.link}
          href="https://github.com/lobehub/lobe-chat/tree/main/src/config/aiModels"
          rel="noreferrer"
          target="_blank"
        >
          {t('mcp.details.nav.viewSourceCode')}
        </a>
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
