'use client';

import { createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
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

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: auto;
    width: 100%;
    height: 100%;
  `,
  heading: css`
    text-align: center;
  `,
  intro: css`
    width: 100%;
    max-width: 760px;
    margin-inline: auto;
  `,
  page: css`
    box-sizing: border-box;
    width: min(1060px, calc(100% - 64px));
    min-height: 100%;
    margin-inline: auto;
    padding-block: 48px;

    @media (width <= 720px) {
      width: calc(100% - 40px);
      padding-block: 32px;
    }
  `,
  shell: css`
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
}));

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
    <Flexbox className={styles.shell} flex={1}>
      <div className={styles.content}>
        <Flexbox className={styles.page} gap={0} justify={'center'}>
          <Flexbox className={styles.intro} gap={18}>
            <Flexbox align={'center'} className={styles.heading} gap={5}>
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
