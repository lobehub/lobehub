'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import AddButton from '@/features/ResourceManager/components/Header/AddButton';

import Libraries from './Libraries';
import QuickActions from './QuickActions';
import RecentFiles from './RecentFiles';
import RecentPages from './RecentPages';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    width: 100%;
    max-width: 1080px;
    margin-inline: auto;
    padding-block: 32px 64px;
    padding-inline: 32px;
  `,
  greeting: css`
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  scroll: css`
    overflow: hidden auto;
    flex: 1;
  `,
  subtitle: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const getGreetingKey = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'home.greeting.morning' as const;
  if (hour < 18) return 'home.greeting.afternoon' as const;
  return 'home.greeting.evening' as const;
};

/**
 * The library-style landing page of /resource: greeting, quick actions,
 * recent files / pages and libraries — instead of the flat all-files table
 * (which now lives at /resource/all).
 */
const ResourceHomeDashboard = memo(() => {
  const { t } = useTranslation('file');

  return (
    <Flexbox height={'100%'}>
      <NavHeader
        left={<Flexbox style={{ marginLeft: 8 }}>{t('resource')}</Flexbox>}
        right={<AddButton />}
        style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
      />
      <div className={styles.scroll}>
        <Flexbox className={styles.content} gap={40}>
          <Flexbox gap={8}>
            <h1 className={styles.greeting}>{t(getGreetingKey())}</h1>
            <span className={styles.subtitle}>{t('home.subtitle')}</span>
          </Flexbox>
          <QuickActions />
          <RecentFiles />
          <RecentPages />
          <Libraries />
        </Flexbox>
      </div>
    </Flexbox>
  );
});

ResourceHomeDashboard.displayName = 'ResourceHomeDashboard';

export default ResourceHomeDashboard;
