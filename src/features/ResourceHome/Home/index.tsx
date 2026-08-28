'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import AddButton from '@/features/ResourceManager/components/Header/AddButton';

import Libraries from './Libraries';
import RecentFiles from './RecentFiles';
import RecentPages from './RecentPages';
import RecentWorks from './RecentWorks';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    width: 100%;
    max-width: 1080px;
    margin-inline: auto;
    padding-block: 32px 64px;
    padding-inline: 32px;
  `,
  scroll: css`
    overflow: hidden auto;
    flex: 1;
  `,
}));

/**
 * The library-style landing page of /resource: libraries (once — the sidebar
 * holds the full index), then works → recent pages → recent files, instead of
 * the flat all-files table (which now lives at /resource/all).
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
          <Libraries />
          <RecentWorks />
          <RecentPages />
          <RecentFiles />
        </Flexbox>
      </div>
    </Flexbox>
  );
});

ResourceHomeDashboard.displayName = 'ResourceHomeDashboard';

export default ResourceHomeDashboard;
