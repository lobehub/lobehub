import { Flexbox } from '@lobehub/ui';
import { Tabs, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useProjectStore } from '@/store/project';

import { GeneralSettings } from './GeneralSettings';
import { ProjectWorkingDirectories } from './index';
import { WorkingDirectorySettings } from './WorkingDirectorySettings';

export function ProjectDirectoriesPage() {
  const { t } = useTranslation('project');
  const { section = 'general' } = useParams<{ section?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectDetail)(
    projectId,
  );
  if (isLoading && !data) return <RouteLoading />;
  if (error && !data) return <AsyncError error={error} variant="page" onRetry={mutate} />;
  if (!data) return null;
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
          <GeneralSettings key={data.data.project.id} project={data.data.project} />
        ) : section === 'directories' ? (
          <WorkingDirectorySettings projectId={data.data.project.id} />
        ) : (
          <ProjectWorkingDirectories projectId={data.data.project.id} />
        )}
      </Flexbox>
    </Flexbox>
  );
}
