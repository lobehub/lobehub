import { Flexbox, Tabs, Text } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { ProjectKnowledgeBaseSettings } from '../KnowledgeBases';
import { ProjectMemberSettings } from '../Members';
import { MembersSettings } from '../Review/MembersSettings';
import { SitesSettings } from '../Review/SitesSettings';
import { useCanManageProject } from '../useCanManageProject';
import { AdvancedSettings } from './AdvancedSettings';
import { GeneralSettings } from './GeneralSettings';
import { ProjectWorkingDirectories } from './index';
import { WorkingDirectorySettings } from './WorkingDirectorySettings';

interface SectionItem {
  key: string;
  label: string;
  render: () => ReactNode;
}

export function ProjectDirectoriesPage() {
  const { t } = useTranslation('project');
  const { section = 'general' } = useParams<{ section?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const { error, revalidate } = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const canManage = useCanManageProject();
  const detail = useCurrentProjectDetail(projectId);
  if (error && !detail) return <AsyncError error={error} variant="page" onRetry={revalidate} />;
  if (!detail) return <RouteLoading />;

  const sections: SectionItem[] = [
    {
      key: 'general',
      label: t('settings.general'),
      render: () => <GeneralSettings key={detail.project.id} project={detail.project} />,
    },
    {
      key: 'members',
      label: t('settings.members'),
      render: () => (
        <Flexbox gap={32}>
          <ProjectMemberSettings detail={detail} />
          <MembersSettings projectId={detail.project.id} />
        </Flexbox>
      ),
    },
    {
      key: 'knowledge',
      label: t('settings.knowledgeBases'),
      render: () => <ProjectKnowledgeBaseSettings detail={detail} />,
    },
    {
      key: 'environments',
      label: t('settings.environments'),
      render: () => <ProjectWorkingDirectories projectId={detail.project.id} />,
    },
    {
      key: 'directories',
      label: t('settings.workLocations'),
      render: () => <WorkingDirectorySettings projectId={detail.project.id} />,
    },
    {
      key: 'sites',
      label: t('review.sites.title'),
      render: () => <SitesSettings projectId={detail.project.id} />,
    },
    // Destructive settings need edit permission, so the tab is hidden from viewers.
    ...(canManage
      ? [
          {
            key: 'advanced',
            label: t('settings.advanced'),
            render: () => <AdvancedSettings project={detail.project} />,
          },
        ]
      : []),
  ];
  const activeSection = sections.find((item) => item.key === section) ?? sections[0];

  return (
    <Flexbox flex={1} padding={32} style={{ overflow: 'auto' }}>
      <Flexbox gap={28} style={{ width: '100%', maxWidth: 800, marginInline: 'auto' }}>
        <Text fontSize={24} weight={600}>
          {t('settings.title')}
        </Text>
        <Tabs
          activeKey={activeSection.key}
          items={sections.map(({ key, label }) => ({ key, label }))}
          variant="square"
          onChange={(key) => navigate(`/project/${projectId}/settings/${key}`)}
        />
        {activeSection.render()}
      </Flexbox>
    </Flexbox>
  );
}
