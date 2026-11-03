'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BookOpenIcon, ListIcon, Settings2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { GITHUB, GITHUB_ISSUES } from '@/const/url';
import { ModelNavKey } from '@/types/discover';

const styles = stylex.create({
  link: { color: { 'default': cssVar.colorTextDescription, ':hover': cssVar.colorInfo } },
  nav: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
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
      variant="square"
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
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.nav).className}
      justify={'space-between'}
    >
      {nav}
      <Flexbox
        horizontal
        flex="none"
        gap={12}
        style={{ marginInlineStart: 12, whiteSpace: 'nowrap' }}
      >
        <a
          {...stylex.props(styles.link)}
          href={SOCIAL_URL.discord}
          rel="noreferrer"
          target="_blank"
        >
          {t('mcp.details.nav.needHelp')}
        </a>
        <a
          {...stylex.props(styles.link)}
          href={urlJoin(GITHUB, 'tree/main/src/config/aiModels')}
          rel="noreferrer"
          target="_blank"
        >
          {t('mcp.details.nav.viewSourceCode')}
        </a>
        <a {...stylex.props(styles.link)} href={GITHUB_ISSUES} rel="noreferrer" target="_blank">
          {t('mcp.details.nav.reportIssue')}
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
