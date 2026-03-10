'use client';

import { Flexbox, Icon, Tabs, Tag } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, DownloadIcon, FileTextIcon, HistoryIcon, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useDetailContext } from '../DetailProvider';
import { SkillNavKey } from '../types';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    color: ${cssVar.colorTextDescription};

    &:hover {
      color: ${cssVar.colorInfo};
    }
  `,
  nav: css`
    border-block-end: 1px solid ${cssVar.colorBorder};
  `,
}));

const Nav = memo<{
  activeTab?: SkillNavKey;
  mobile?: boolean;
  setActiveTab?: (_tab: SkillNavKey) => void;
}>(({ mobile, setActiveTab, activeTab = SkillNavKey.Overview }) => {
  const { t } = useTranslation('discover');
  const { versions, repository, homepage, github, resources } = useDetailContext();

  const versionCount = versions?.length || 0;
  const resourcesCount = Object.keys(resources || {}).length;
  const source = homepage || repository;
  const issueTarget = github?.url || repository;

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: SkillNavKey.Overview,
          label: t('skills.details.overview.title'),
        },
        {
          icon: <Icon icon={DownloadIcon} size={16} />,
          key: SkillNavKey.Installation,
          label: t('skills.details.sidebar.installationConfig'),
        },
        {
          icon: <Icon icon={SkillsIcon} size={16} />,
          key: SkillNavKey.Skill,
          label: 'SKILL.md',
        },
        {
          icon: <Icon icon={FileTextIcon} size={16} />,
          key: SkillNavKey.Resources,
          label:
            resourcesCount > 1 ? (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                style={{
                  display: 'inline-flex',
                }}
              >
                {t('skills.details.resources.title')}
                <Tag>{resourcesCount}</Tag>
              </Flexbox>
            ) : (
              t('skills.details.resources.title')
            ),
        },
        {
          icon: <Icon icon={ListIcon} size={16} />,
          key: SkillNavKey.Related,
          label: t('skills.details.related.title'),
        },
        {
          icon: <Icon icon={HistoryIcon} size={16} />,
          key: SkillNavKey.Version,
          label:
            versionCount > 1 ? (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                style={{
                  display: 'inline-flex',
                }}
              >
                {t('skills.details.versions.title')}
                <Tag>{versionCount}</Tag>
              </Flexbox>
            ) : (
              t('skills.details.versions.title')
            ),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as SkillNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
      {nav}
      <Flexbox horizontal gap={12}>
        <a
          className={styles.link}
          href="https://discord.gg/AYFPHvv2jT"
          rel="noopener noreferrer"
          target={'_blank'}
        >
          {t('skills.details.nav.needHelp')}
        </a>
        {source && (
          <a className={styles.link} href={source} rel="noopener noreferrer" target={'_blank'}>
            {t('skills.details.nav.viewSourceCode')}
          </a>
        )}
        {issueTarget && (
          <a
            className={styles.link}
            href={urlJoin(issueTarget, 'issues')}
            rel="noopener noreferrer"
            target={'_blank'}
          >
            {t('skills.details.nav.reportIssue')}
          </a>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
