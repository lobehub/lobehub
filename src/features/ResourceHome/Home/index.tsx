'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import AddButton from '@/features/ResourceManager/components/Header/AddButton';
import { useHomeStore } from '@/store/home';
import type { DocsHomeTab } from '@/store/home/slices/recent/projection';

import HomeList from './HomeList';
import QuickActions from './QuickActions';

const styles = stylex.create({
  content: {
    width: '100%',
    maxWidth: '1200px',
    marginInline: 'auto',
    paddingBlockStart: '24px',
    paddingBlockEnd: '64px',
    paddingInline: '32px',
  },
  scroll: {
    overflowX: 'hidden',
    overflowY: 'auto',
    flex: '1',
  },
});

/**
 * The Docs home: three ways to add something, then everything in Docs as one
 * list — recently updated, created by me, or shared by teammates.
 */
const ResourceHomeDashboard = memo(() => {
  const { t } = useTranslation('file');
  const [tab, setTab] = useState<DocsHomeTab>('recent');
  const refreshDocsHome = useHomeStore((s) => s.refreshDocsHome);

  return (
    <Flexbox height={'100%'}>
      <NavHeader
        left={<Flexbox style={{ marginLeft: 8 }}>{t('docs.section.home')}</Flexbox>}
        right={<AddButton />}
        style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
      />
      <div {...stylex.props(styles.scroll)}>
        <Flexbox gap={28} {...stylex.props(styles.content)}>
          <QuickActions onCreated={() => void refreshDocsHome()} />
          <HomeList tab={tab} onTabChange={setTab} />
        </Flexbox>
      </div>
    </Flexbox>
  );
});

ResourceHomeDashboard.displayName = 'ResourceHomeDashboard';

export default ResourceHomeDashboard;
