'use client';

import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useCurrentProjectDetail } from '@/store/project';

/**
 * Mobile shell header title for the project home. Desktop names the project in
 * the sidebar, which mobile hides in a drawer, so the header carries the name.
 */
const ProjectMobileShellTitle = () => {
  const { t } = useTranslation('project');
  const { projectId } = useParams<{ projectId: string }>();
  const name = useCurrentProjectDetail(projectId)?.project.name;

  return (
    <Text ellipsis weight={500}>
      {name || t('sections.home')}
    </Text>
  );
};

export default ProjectMobileShellTitle;
