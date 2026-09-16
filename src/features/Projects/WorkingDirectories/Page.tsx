import { Flexbox } from '@lobehub/ui';
import { Segmented, Text } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useProjectStore } from '@/store/project';

import { GeneralSettings } from './GeneralSettings';
import { ProjectWorkingDirectories } from './index';

export function ProjectDirectoriesPage() {
  const { t } = useTranslation('project');
  const [section, setSection] = useState('general');
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
        <Segmented
          value={section}
          options={[
            { label: t('settings.general'), value: 'general' },
            { label: t('settings.environments'), value: 'environments' },
          ]}
          onChange={setSection}
        />
        {section === 'general' ? (
          <GeneralSettings key={data.data.project.id} project={data.data.project} />
        ) : (
          <ProjectWorkingDirectories projectId={data.data.project.id} />
        )}
      </Flexbox>
    </Flexbox>
  );
}
