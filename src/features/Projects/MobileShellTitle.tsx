'use client';

import { Text } from '@lobehub/ui';
import { useParams } from 'react-router';

import { useCurrentProjectDetail } from '@/store/project';

/**
 * Mobile shell header title for the project home. Desktop names the project in
 * the sidebar, which mobile hides in a drawer, so the header carries the name.
 * Empty until the project loads, rather than a generic label that then changes.
 */
const ProjectMobileShellTitle = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const name = useCurrentProjectDetail(projectId)?.project.name;

  if (!name) return null;

  return (
    <Text ellipsis weight={500}>
      {name}
    </Text>
  );
};

export default ProjectMobileShellTitle;
