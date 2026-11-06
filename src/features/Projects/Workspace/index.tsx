'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import ProjectDisabled from '@/features/Projects/ProjectDisabled';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import ProjectComposer from './ProjectComposer';

const styles = stylex.create({
  content: { overflow: 'auto', width: '100%', height: '100%' },
  heading: { textAlign: 'center' },
  intro: { width: '100%', maxWidth: '760px', marginInline: 'auto' },
  page: {
    boxSizing: 'border-box',
    width: {
      'default': 'min(1060px, calc(100% - 64px))',
      '@media (width <= 720px)': 'calc(100% - 40px)',
    },
    marginInline: 'auto',
    minHeight: '100%',
    paddingBlock: { 'default': '48px', '@media (width <= 720px)': '32px' },
  },
  shell: {
    overflow: 'hidden',
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const ProjectWorkspace = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useParams<{ projectId: string }>();
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const detail = useCurrentProjectDetail(projectId);
  const { error, revalidate } = useProjectStore((s) => s.useFetchProjectDetail)(projectId);

  if (!enabled) return <ProjectDisabled />;
  if (error && !detail)
    return <AsyncError error={error} variant={'page'} onRetry={() => revalidate()} />;
  if (!detail) return <RouteLoading />;

  return (
    <Flexbox className={stylex.props(styles.shell).className} flex={1}>
      <div className={stylex.props(styles.content).className}>
        <Flexbox className={stylex.props(styles.page).className} gap={0} justify={'center'}>
          <Flexbox className={stylex.props(styles.intro).className} gap={18}>
            <Flexbox align={'center'} className={stylex.props(styles.heading).className} gap={5}>
              <Text fontSize={26} weight={650}>
                {t('overview.title')}
              </Text>
              <Text type={'secondary'}>{t('overview.description')}</Text>
            </Flexbox>
            <ProjectComposer detail={detail} key={detail.project.id} />
          </Flexbox>
          {/* The overview dashboard (./ProjectDashboard) is hidden until its replacement is designed */}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

ProjectWorkspace.displayName = 'ProjectWorkspace';

export default ProjectWorkspace;
