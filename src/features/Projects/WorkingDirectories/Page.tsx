import { Flexbox } from '@lobehub/ui';
import { Tabs, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { GeneralSettings } from './GeneralSettings';
import { ProjectWorkingDirectories } from './index';
import { WorkingDirectorySettings } from './WorkingDirectorySettings';

export function ProjectDirectoriesPage() {
  const { t } = useTranslation('project');
  const { section = 'general' } = useParams<{ section?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const { error, revalidate } = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const detail = useCurrentProjectDetail(projectId);
  if (error && !detail) return <AsyncError error={error} variant="page" onRetry={revalidate} />;
  if (!detail) return <RouteLoading />;
  return (
    <Flexbox flex={1} padding={32} style={{ overflow: 'auto' }}>
      <Flexbox gap={28} style={{ width: '100%', maxWidth: 800, marginInline: 'auto' }}>
        <Text fontSize={24} weight={600}>
          {t('settings.title')}
        </Text>
        <Tabs
          activeKey={section}
          variant="square"
          items={[
            { label: t('settings.general'), key: 'general' },
            { label: t('settings.environments'), key: 'environments' },
            { label: t('settings.workLocations'), key: 'directories' },
          ]}
          onChange={(key) => navigate(`/project/${projectId}/settings/${key}`)}
        />
        {section === 'general' ? (
          <GeneralSettings key={detail.project.id} project={detail.project} />
        ) : section === 'directories' ? (
          <WorkingDirectorySettings projectId={detail.project.id} />
        ) : (
          <ProjectWorkingDirectories projectId={detail.project.id} />
        )}
      </Flexbox>
    </Flexbox>
  );
}
